/// Axum route handlers for the Gaia-X compliance wizard.
///
/// All wizard endpoints are session + tenant protected.
/// The .well-known endpoints are public (no auth required).
use axum::response::IntoResponse;
use axum::{Json, extract::State};
use axum::http::HeaderMap;
use axum::http::header::HOST;
use jiff::Timestamp;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use rusqlite::OptionalExtension;

use crate::AppState;
use crate::error::{bad_request_response, data_response, error_body, internal_error_response};
use crate::gaia_x::{ComplyRequest, ComplyResponse, WizardState, WizardStateResponse, cert, credentials, db, gxdch, keys, signing, vp};
use crate::middleware::tenant::RequireParticipant;

use axum::http::StatusCode;
use axum::response::Response;

// ── Response types ────────────────────────────────────────────────────────────

fn json_object() -> utoipa::openapi::schema::Object {
    use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder};
    ObjectBuilder::new()
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ComplianceCredential {
    pub name: String,
    pub issued_at: String,
    #[schema(schema_with = json_object)]
    pub raw_json: Value,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ComplianceStatus {
    pub compliant: bool,
    pub verified_at: Option<String>,
    pub credentials: Vec<ComplianceCredential>,
    pub wizard_state: Option<WizardStateResponse>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct GenerateKeysResponse {
    pub private_key_pem: String,
    #[schema(schema_with = json_object)]
    pub public_key_jwk: Value,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ValidateCertResponse {
    pub ok: bool,
    #[schema(schema_with = json_object)]
    pub did_document: Value,
    pub domain_warning: Option<String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct GxdchComplianceResult {
    pub compliant: bool,
    #[schema(schema_with = json_object)]
    pub compliance_vc: Option<Value>,
    pub error: Option<String>,
}

// ── Payload types ─────────────────────────────────────────────────────────────

#[derive(Deserialize, utoipa::ToSchema)]
pub struct CertUploadPayload {
    pub cert_chain_pem: String,
    pub domain: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct LrnPayload {
    pub lrn_type: String,
    pub lrn_value: String,
}

/// LP payload — legal_name and country_code are read from the organization profile.
/// Update them via PUT /v1/org/identity before submitting this step.
#[derive(Deserialize, utoipa::ToSchema)]
pub struct LpPayload {
    pub private_key_pem: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct TcPayload {
    pub private_key_pem: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    Timestamp::now().to_string()
}

/// Build a default empty wizard state for an org that hasn't started the wizard.
fn default_state(org_id: &str) -> WizardState {
    WizardState {
        org_id: org_id.to_string(),
        current_step: 0,
        public_key_jwk: None,
        cert_chain_pem: None,
        root_ca_pem: None,
        lrn_credential: None,
        lp_credential: None,
        tc_credential: None,
        compliance_vc: None,
        lrn_type: None,
        lrn_value: None,
        domain: None,
        updated_at: now_iso(),
    }
}

// ── Wizard state helpers (extract repeated load/validate/save patterns) ──────

/// Load the wizard state from DB, returning an error response if no record exists.
async fn load_wizard(state: &AppState, org_id: &str) -> Result<WizardState, Response> {
    let (_permit, conn) = state.db.read().await;
    match db::get_wizard_state(&conn, org_id) {
        Ok(Some(w)) => Ok(w),
        Ok(None) => Err(bad_request_response("Wizard not started — complete previous steps first")),
        Err(e) => Err(internal_error_response(&format!("db read failed: {e}"))),
    }
}

/// Save the wizard state to DB, upserting if needed. Returns the saved state.
async fn save_wizard_step(state: &AppState, wizard: &WizardState) -> Result<WizardState, Response> {
    let conn = state.db.write().await;
    let existing = db::get_wizard_state(&conn, &wizard.org_id)
        .map_err(|e| internal_error_response(&format!("db read for write failed: {e}")))?;
    let mut w = existing.unwrap_or_else(|| default_state(&wizard.org_id));
    // Copy all fields from the incoming wizard state
    w.public_key_jwk = wizard.public_key_jwk.clone();
    w.cert_chain_pem = wizard.cert_chain_pem.clone();
    w.root_ca_pem = wizard.root_ca_pem.clone();
    w.lrn_credential = wizard.lrn_credential.clone();
    w.lp_credential = wizard.lp_credential.clone();
    w.tc_credential = wizard.tc_credential.clone();
    w.compliance_vc = wizard.compliance_vc.clone();
    w.lrn_type = wizard.lrn_type.clone();
    w.lrn_value = wizard.lrn_value.clone();
    w.domain = wizard.domain.clone();
    if wizard.current_step > w.current_step {
        w.current_step = wizard.current_step;
    }
    w.updated_at = now_iso();
    db::upsert_wizard_state(&conn, &w)
        .map_err(|e| internal_error_response(&format!("failed to save wizard state: {e}")))?;
    Ok(w)
}

/// Require cert chain from wizard state, returning a 400 if missing or invalid.
fn require_cert_chain(wizard: &WizardState) -> Result<String, Response> {
    let cert_pem = wizard.cert_chain_pem.as_ref()
        .ok_or_else(|| bad_request_response("Certificate not uploaded — complete step 2 first"))?
        .clone();
    cert::validate_chain(&cert_pem)
        .map_err(|e| bad_request_response(format!("Certificate validation failed: {}", e.0)))?;
    Ok(cert_pem)
}

/// Require domain from wizard state, returning a 400 if missing.
fn require_domain(wizard: &WizardState) -> Result<String, Response> {
    wizard.domain.as_ref()
        .ok_or_else(|| bad_request_response("Domain not set — complete step 2 first"))
        .cloned()
}

/// Get or create an HTTP client for GXDCH calls.
fn gxdch_client(timeout_secs: u64) -> Result<reqwest::Client, Response> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| internal_error_response(&format!("failed to create HTTP client: {e}")))
}

// ── .well-known org resolution ────────────────────────────────────────────────

/// Resolve the organization for .well-known endpoints.
/// 1. If `base_domain` is configured: extract slug from Host header (`{slug}.{base_domain}`)
/// 2. Fallback: `?org=` query param (dev/local)
async fn resolve_org_id_from_request(
    state: &AppState,
    headers: &HeaderMap,
    params: &HashMap<String, String>,
) -> Result<String, Response> {
    if let Some(base_domain) = &state.gaia_x.base_domain {
        if let Some(host) = headers.get(HOST).and_then(|h| h.to_str().ok()) {
            let host_no_port = host.split(':').next().unwrap_or(host);
            if let Some(slug) = host_no_port.strip_suffix(&format!(".{}", base_domain)) {
                if !slug.is_empty() && !slug.contains('.') {
                    if let Some(org) = state.db.get_organization_by_slug(slug).await {
                        return Ok(org.id);
                    }
                    return Err((
                        StatusCode::NOT_FOUND,
                        Json(error_body("not_found", "Organization not found for subdomain")),
                    ).into_response());
                }
            }
        }
    }

    params.get("org").cloned().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", "Missing ?org=<org_id> query parameter")),
        ).into_response()
    })
}

// ── a) GET /v1/gaia-x/wizard ──────────────────────────────────────────────────

#[utoipa::path(get, path = "/v1/gaia-x/wizard", tag = "Gaia-X Compliance",
    responses((status = 200, description = "Current wizard state", body = WizardStateResponse))
)]
pub async fn get_wizard_state(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;
    // Helper: auto-fill domain from org slug + base_domain if configured
    let auto_fill_domain = |ws: &mut WizardState| {
        if ws.domain.is_none() {
            if let Some(base_domain) = &state.gaia_x.base_domain {
                if let Ok(Some(slug)) = conn.query_row(
                    "SELECT slug FROM organizations WHERE id = ?1",
                    rusqlite::params![&org_id],
                    |row| Ok(row.get::<_, String>(0)?),
                ).optional() {
                    ws.domain = Some(format!("{}.{}", slug, base_domain));
                }
            }
        }
    };

    match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(mut wizard)) => {
            auto_fill_domain(&mut wizard);
            data_response(WizardStateResponse::from(wizard)).into_response()
        }
        Ok(None) => {
            let mut ws = default_state(&org_id);
            // Pre-fill lrn_value from org registration_number if available
            if let Ok(Some(rn)) = conn.query_row(
                "SELECT registration_number FROM organizations WHERE id = ?1",
                rusqlite::params![&org_id],
                |row| Ok(row.get::<_, Option<String>>(0)?),
            ).optional() {
                if let Some(r) = rn { ws.lrn_value = Some(r); }
            }
            auto_fill_domain(&mut ws);
            data_response(WizardStateResponse::from(ws)).into_response()
        }
        Err(e) => internal_error_response(&format!("failed to load wizard state: {e}")),
    }
}

// ── b) POST /v1/gaia-x/wizard/keys ───────────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/keys", tag = "Gaia-X Compliance",
    responses((status = 200, description = "Generated key pair", body = GenerateKeysResponse))
)]
pub async fn generate_keys(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let pair = match keys::generate_key_pair() {
        Ok(p) => p,
        Err(e) => return internal_error_response(&format!("key generation failed: {e}")),
    };

    let jwk_str = match serde_json::to_string(&pair.public_key_jwk) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize JWK: {e}")),
    };

    let org_id = ctx.org_id.0.clone();
    let conn = state.db.write().await;
    let existing = match db::get_wizard_state(&conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };
    let mut wizard = existing.unwrap_or_else(|| default_state(&org_id));
    wizard.public_key_jwk = Some(jwk_str);
    if wizard.current_step < 1 {
        wizard.current_step = 1;
    }
    wizard.updated_at = now_iso();

    if let Err(e) = db::upsert_wizard_state(&conn, &wizard) {
        return internal_error_response(&format!("failed to save wizard state: {e}"));
    }

    data_response(GenerateKeysResponse {
        private_key_pem: pair.private_key_pem,
        public_key_jwk: pair.public_key_jwk,
    })
    .into_response()
}

// ── c) POST /v1/gaia-x/wizard/certificate ────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/certificate", tag = "Gaia-X Compliance",
    request_body = CertUploadPayload,
    responses(
        (status = 200, description = "Certificate validated and DID document assembled", body = ValidateCertResponse),
        (status = 400, description = "Invalid certificate"),
    )
)]
pub async fn validate_certificate(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<CertUploadPayload>,
) -> Response {
    // VC-05: validate chain
    if let Err(e) = cert::validate_chain(&payload.cert_chain_pem) {
        return bad_request_response(e.0);
    }

    let org_id = ctx.org_id.0.clone();

    // Load existing state to get stored public key JWK.
    let (_permit, read_conn) = state.db.read().await;
    let existing = match db::get_wizard_state(&read_conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };
    drop(read_conn);
    drop(_permit);

    let stored_jwk_str = match existing.as_ref().and_then(|s| s.public_key_jwk.as_ref()) {
        Some(j) => j.clone(),
        None => return bad_request_response("Key pair not generated yet — complete step 1 first"),
    };

    let public_key_jwk: Value = match serde_json::from_str(&stored_jwk_str) {
        Ok(v) => v,
        Err(e) => return internal_error_response(&format!("failed to parse stored JWK: {e}")),
    };

    let domain = &payload.domain;

    let domain_warning = if domain.starts_with("localhost")
        || domain.starts_with("127.")
        || domain.starts_with("192.168.")
        || domain.starts_with("10.")
        || domain.starts_with("172.")
    {
        Some("Domain appears to be a private/local address. GXDCH cannot resolve did:web from this domain — use a public domain for real compliance submissions.".to_string())
    } else {
        None
    };

    // Assemble DID document in memory (not persisted).
    let cert_url = format!("https://{}/.well-known/x509CertificateChain.pem", domain);
    let did = format!("did:web:{domain}");
    let key_id = format!("did:web:{domain}#key-1");

    let mut pub_jwk_with_x5u = public_key_jwk.clone();
    if let Some(obj) = pub_jwk_with_x5u.as_object_mut() {
        obj.insert("x5u".to_string(), serde_json::Value::String(cert_url));
    }

    let did_document = serde_json::json!({
        "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/jws-2020/v1"
        ],
        "id": did,
        "verificationMethod": [{
            "id": key_id,
            "type": "JsonWebKey2020",
            "controller": did,
            "publicKeyJwk": pub_jwk_with_x5u
        }],
        "assertionMethod": [key_id],
        "authentication": [key_id]
    });

    // Persist cert_chain_pem and domain only (did_document is NOT persisted).
    let conn = state.db.write().await;
    let existing2 = match db::get_wizard_state(&conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error_response(&format!("db read for write failed: {e}")),
    };
    let mut wizard = existing2.unwrap_or_else(|| default_state(&org_id));
    wizard.cert_chain_pem = Some(payload.cert_chain_pem.clone());
    wizard.domain = Some(domain.to_string());
    if wizard.current_step < 2 {
        wizard.current_step = 2;
    }
    wizard.updated_at = now_iso();

    if let Err(e) = db::upsert_wizard_state(&conn, &wizard) {
        return internal_error_response(&format!("failed to save wizard state: {e}"));
    }

    data_response(ValidateCertResponse {
        ok: true,
        did_document,
        domain_warning,
    })
    .into_response()
}

// ── d) POST /v1/gaia-x/wizard/lrn ────────────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/lrn", tag = "Gaia-X Compliance",
    request_body = LrnPayload,
    responses(
        (status = 200, description = "LRN credential obtained and wizard state updated", body = WizardStateResponse),
        (status = 400, description = "Wizard not ready"),
        (status = 502, description = "GXDCH notary error"),
    )
)]
pub async fn request_lrn(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<LrnPayload>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let mut wizard = match load_wizard(&state, &org_id).await {
        Ok(w) => w,
        Err(r) => return r,
    };

    let _cert_pem = match require_cert_chain(&wizard) { Ok(c) => c, Err(r) => return r };
    let domain = match require_domain(&wizard) { Ok(d) => d, Err(r) => return r };
    let client = match gxdch_client(30) { Ok(c) => c, Err(r) => return r };

    let lrn_vc = match gxdch::request_lrn_credential(
        &client,
        &state.gaia_x.gxdch_notary_url,
        &domain,
        &payload.lrn_type,
        &payload.lrn_value,
    )
    .await
    {
        Ok(vc) => vc,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(error_body("gxdch_error", e)),
            )
                .into_response()
        }
    };

    let lrn_str = match serde_json::to_string(&lrn_vc) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize LRN VC: {e}")),
    };

    wizard.lrn_credential = Some(lrn_str);
    wizard.lrn_type = Some(payload.lrn_type.clone());
    wizard.lrn_value = Some(payload.lrn_value.clone());
    wizard.current_step = 3;
    match save_wizard_step(&state, &wizard).await {
        Ok(saved) => data_response(WizardStateResponse::from(saved)).into_response(),
        Err(r) => r,
    }
}

// ── e) POST /v1/gaia-x/wizard/legal-participant ───────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/legal-participant", tag = "Gaia-X Compliance",
    request_body = LpPayload,
    responses(
        (status = 200, description = "Legal Participant credential signed and wizard state updated", body = WizardStateResponse),
        (status = 400, description = "Wizard not ready or key mismatch"),
    )
)]
pub async fn sign_legal_participant(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<LpPayload>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let mut wizard = match load_wizard(&state, &org_id).await {
        Ok(w) => w,
        Err(r) => return r,
    };

    let _cert_pem = match require_cert_chain(&wizard) { Ok(c) => c, Err(r) => return r };
    let domain = match require_domain(&wizard) { Ok(d) => d, Err(r) => return r };

    // Read legal_name and country_code from the organization (source of truth).
    let org = match state.db.get_organization(&org_id).await {
        Some(o) => o,
        None => return internal_error_response("Organization not found"),
    };
    let legal_name = org.legal_name.clone();
    let country_code = org.country.clone();

    // Verify private key matches stored public key.
    let stored_jwk: Value = match wizard.public_key_jwk.as_ref() {
        Some(j) => match serde_json::from_str(j) {
            Ok(v) => v,
            Err(e) => return internal_error_response(&format!("failed to parse stored JWK: {e}")),
        },
        None => return bad_request_response("Key pair not generated yet — complete step 1 first"),
    };

    if let Err(e) = keys::verify_key_match(&payload.private_key_pem, &stored_jwk) {
        return bad_request_response(e);
    }

    // Assemble LP credential and sign in-memory.
    let mut lp_cred = credentials::assemble_legal_participant(
        &domain,
        &legal_name,
        &country_code,
    );

    if let Err(e) = signing::sign_credential(&mut lp_cred, &payload.private_key_pem, &domain) {
        return internal_error_response(&format!("signing failed: {e}"));
    }
    // private_key_pem is dropped when `payload` is dropped at end of scope — never stored.

    let lp_str = match serde_json::to_string(&lp_cred) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize LP credential: {e}")),
    };

    wizard.lp_credential = Some(lp_str);
    wizard.current_step = 4;
    match save_wizard_step(&state, &wizard).await {
        Ok(saved) => data_response(WizardStateResponse::from(saved)).into_response(),
        Err(r) => r,
    }
}

// ── f) POST /v1/gaia-x/wizard/terms ──────────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/terms", tag = "Gaia-X Compliance",
    request_body = TcPayload,
    responses(
        (status = 200, description = "Terms & Conditions credential signed and wizard state updated", body = WizardStateResponse),
        (status = 400, description = "Wizard not ready or key mismatch"),
    )
)]
pub async fn sign_terms_conditions(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<TcPayload>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let mut wizard = match load_wizard(&state, &org_id).await {
        Ok(w) => w,
        Err(r) => return r,
    };

    let _cert_pem = match require_cert_chain(&wizard) { Ok(c) => c, Err(r) => return r };
    let domain = match require_domain(&wizard) { Ok(d) => d, Err(r) => return r };

    let stored_jwk: Value = match wizard.public_key_jwk.as_ref() {
        Some(j) => match serde_json::from_str(j) {
            Ok(v) => v,
            Err(e) => return internal_error_response(&format!("failed to parse stored JWK: {e}")),
        },
        None => return bad_request_response("Key pair not generated yet — complete step 1 first"),
    };

    if let Err(e) = keys::verify_key_match(&payload.private_key_pem, &stored_jwk) {
        return bad_request_response(e);
    }

    let mut tc_cred = credentials::assemble_terms_conditions(&domain);

    if let Err(e) = signing::sign_credential(&mut tc_cred, &payload.private_key_pem, &domain) {
        return internal_error_response(&format!("signing failed: {e}"));
    }

    let tc_str = match serde_json::to_string(&tc_cred) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize T&C credential: {e}")),
    };

    wizard.tc_credential = Some(tc_str);
    wizard.current_step = 5;
    match save_wizard_step(&state, &wizard).await {
        Ok(saved) => data_response(WizardStateResponse::from(saved)).into_response(),
        Err(r) => r,
    }
}

// ── g) POST /v1/gaia-x/wizard/submit ─────────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/submit", tag = "Gaia-X Compliance",
    responses(
        (status = 200, description = "Compliance submission result", body = GxdchComplianceResult),
        (status = 400, description = "Credentials missing"),
    )
)]
pub async fn submit_gxdch(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let mut wizard = match load_wizard(&state, &org_id).await {
        Ok(w) => w,
        Err(r) => return r,
    };

    let _cert_pem = match require_cert_chain(&wizard) { Ok(c) => c, Err(r) => return r };

    let lrn: Value = match wizard.lrn_credential.as_ref() {
        Some(s) => match serde_json::from_str(s) {
            Ok(v) => v,
            Err(e) => return internal_error_response(&format!("failed to parse LRN credential: {e}")),
        },
        None => return bad_request_response("LRN credential missing — complete step 3 first"),
    };
    let lp: Value = match wizard.lp_credential.as_ref() {
        Some(s) => match serde_json::from_str(s) {
            Ok(v) => v,
            Err(e) => return internal_error_response(&format!("failed to parse LP credential: {e}")),
        },
        None => return bad_request_response("Legal Participant credential missing — complete step 4 first"),
    };
    let tc: Value = match wizard.tc_credential.as_ref() {
        Some(s) => match serde_json::from_str(s) {
            Ok(v) => v,
            Err(e) => return internal_error_response(&format!("failed to parse T&C credential: {e}")),
        },
        None => return bad_request_response("T&C credential missing — complete step 5 first"),
    };

    let vp_value = vp::assemble_vp(&lrn, &lp, &tc);
    let client = match gxdch_client(60) { Ok(c) => c, Err(r) => return r };

    let compliance_vc = match gxdch::submit_compliance(
        &client,
        &state.gaia_x.gxdch_compliance_url,
        &vp_value,
    )
    .await
    {
        Ok(vc) => vc,
        Err(e) => {
            return data_response(GxdchComplianceResult {
                compliant: false,
                compliance_vc: None,
                error: Some(e),
            })
            .into_response()
        }
    };

    let vc_str = match serde_json::to_string(&compliance_vc) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize compliance VC: {e}")),
    };

    wizard.compliance_vc = Some(vc_str);
    wizard.current_step = 6;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    data_response(GxdchComplianceResult {
        compliant: true,
        compliance_vc: Some(compliance_vc),
        error: None,
    })
    .into_response()
}

// ── h) GET /v1/gaia-x/compliance ─────────────────────────────────────────────

#[utoipa::path(get, path = "/v1/gaia-x/compliance", tag = "Gaia-X Compliance",
    responses((status = 200, description = "Compliance status and credentials", body = ComplianceStatus))
)]
pub async fn get_compliance_status(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;

    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return data_response(ComplianceStatus {
                compliant: false,
                verified_at: None,
                credentials: vec![],
                wizard_state: None,
            })
            .into_response()
        }
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };

    let compliant = wizard.compliance_vc.is_some();

    let credential_fields: &[(&str, &Option<String>)] = &[
        ("LRN Credential", &wizard.lrn_credential),
        ("Legal Participant Credential", &wizard.lp_credential),
        ("Terms & Conditions Credential", &wizard.tc_credential),
        ("Compliance VC", &wizard.compliance_vc),
    ];

    let mut creds: Vec<ComplianceCredential> = Vec::new();
    for (name, field) in credential_fields {
        if let Some(raw) = field {
            let parsed: Value = serde_json::from_str(raw).unwrap_or_default();
            let issued_at = parsed
                .get("issuanceDate")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            creds.push(ComplianceCredential {
                name: name.to_string(),
                issued_at,
                raw_json: parsed,
            });
        }
    }

    data_response(ComplianceStatus {
        compliant,
        verified_at: None,
        credentials: creds,
        wizard_state: Some(WizardStateResponse::from(wizard)),
    })
    .into_response()
}

// ── i) POST /v1/gaia-x/compliance/rerun ──────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/compliance/rerun", tag = "Gaia-X Compliance",
    responses(
        (status = 200, description = "Re-submitted compliance result", body = GxdchComplianceResult),
        (status = 400, description = "Credentials missing"),
    )
)]
pub async fn rerun_compliance(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let mut wizard = match load_wizard(&state, &org_id).await {
        Ok(w) => w,
        Err(r) => return r,
    };

    let lrn: Value = match wizard.lrn_credential.as_ref() {
        Some(s) => serde_json::from_str(s).unwrap_or_default(),
        None => return bad_request_response("LRN credential missing"),
    };
    let lp: Value = match wizard.lp_credential.as_ref() {
        Some(s) => serde_json::from_str(s).unwrap_or_default(),
        None => return bad_request_response("Legal Participant credential missing"),
    };
    let tc: Value = match wizard.tc_credential.as_ref() {
        Some(s) => serde_json::from_str(s).unwrap_or_default(),
        None => return bad_request_response("T&C credential missing"),
    };

    let vp_value = vp::assemble_vp(&lrn, &lp, &tc);
    let client = match gxdch_client(60) { Ok(c) => c, Err(r) => return r };

    let compliance_vc = match gxdch::submit_compliance(
        &client,
        &state.gaia_x.gxdch_compliance_url,
        &vp_value,
    )
    .await
    {
        Ok(vc) => vc,
        Err(e) => {
            return data_response(GxdchComplianceResult {
                compliant: false,
                compliance_vc: None,
                error: Some(e),
            })
            .into_response()
        }
    };

    let vc_str = match serde_json::to_string(&compliance_vc) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize compliance VC: {e}")),
    };

    wizard.compliance_vc = Some(vc_str);
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    data_response(GxdchComplianceResult {
        compliant: true,
        compliance_vc: Some(compliance_vc),
        error: None,
    })
    .into_response()
}

// ── POST /v1/gaia-x/comply — One-click compliance ─────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/comply", tag = "Gaia-X Compliance",
    request_body = ComplyRequest,
    responses(
        (status = 200, description = "Compliance result", body = ComplyResponse),
        (status = 400, description = "Prerequisites missing"),
    )
)]
pub async fn comply(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<ComplyRequest>,
) -> Response {
    let org_id = ctx.org_id.0.clone();

    // 1. Load org and validate prerequisites
    let org = match state.db.get_organization(&org_id).await {
        Some(o) => o,
        None => return bad_request_response("Organization not found"),
    };

    let mut missing = Vec::new();
    if org.legal_name.trim().is_empty() { missing.push("legal_name"); }
    if org.country_subdivision_code.is_none() { missing.push("country_subdivision_code"); }
    if org.registration_number_type.is_none() { missing.push("registration_number_type"); }
    if org.registration_number.as_ref().map_or(true, |s| s.is_empty()) { missing.push("registration_number"); }
    if !missing.is_empty() {
        return data_response(ComplyResponse {
            compliant: false,
            private_key_pem: None,
            compliance_vc: None,
            error: Some(format!("Missing required fields: {}", missing.join(", "))),
            failed_phase: None,
        }).into_response();
    }

    let country_subdivision_code = org.country_subdivision_code.as_ref().unwrap();
    let registration_number_type = org.registration_number_type.as_ref().unwrap();
    let registration_number = org.registration_number.as_ref().unwrap();
    let legal_name = &org.legal_name;

    // 2. Derive domain
    let base_domain = match &state.gaia_x.base_domain {
        Some(bd) => bd.clone(),
        None => return data_response(ComplyResponse {
            compliant: false,
            private_key_pem: None,
            compliance_vc: None,
            error: Some("KEASY_BASE_DOMAIN is not configured".to_string()),
            failed_phase: None,
        }).into_response(),
    };
    let domain = format!("{}.{}", org.slug, base_domain);

    // 3. Generate key pair
    let pair = match keys::generate_key_pair() {
        Ok(p) => p,
        Err(e) => return data_response(ComplyResponse {
            compliant: false,
            private_key_pem: None,
            compliance_vc: None,
            error: Some(format!("Key generation failed: {e}")),
            failed_phase: Some("key_generation".to_string()),
        }).into_response(),
    };
    let private_key_pem = pair.private_key_pem.clone();

    let jwk_str = match serde_json::to_string(&pair.public_key_jwk) {
        Ok(s) => s,
        Err(e) => return data_response(ComplyResponse {
            compliant: false,
            private_key_pem: Some(private_key_pem),
            compliance_vc: None,
            error: Some(format!("Failed to serialize JWK: {e}")),
            failed_phase: Some("key_generation".to_string()),
        }).into_response(),
    };

    // Helper macro for error responses that include the private key
    macro_rules! fail {
        ($phase:expr, $msg:expr) => {
            return data_response(ComplyResponse {
                compliant: false,
                private_key_pem: Some(private_key_pem.clone()),
                compliance_vc: None,
                error: Some($msg),
                failed_phase: Some($phase.to_string()),
            }).into_response()
        };
    }

    // 4. Get cert chain: Caddy volume → request body → error
    let cert_chain_pem = if let Some(caddy_dir) = &state.gaia_x.caddy_certs_dir {
        match cert::read_caddy_cert_chain(caddy_dir, &base_domain) {
            Ok(pem) => pem,
            Err(_) => match payload.cert_chain_pem {
                Some(ref pem) if !pem.is_empty() => pem.clone(),
                _ => fail!("certificate", "Could not read Caddy certificates and no cert_chain_pem provided".to_string()),
            },
        }
    } else {
        match payload.cert_chain_pem {
            Some(ref pem) if !pem.is_empty() => pem.clone(),
            _ => fail!("certificate", "KEASY_CADDY_CERTS_DIR not configured and no cert_chain_pem provided".to_string()),
        }
    };

    // 5. Validate cert chain
    if let Err(e) = cert::validate_chain(&cert_chain_pem) {
        fail!("certificate", format!("Certificate validation failed: {}", e.0));
    }

    // 6. Save keys + cert + domain to org_gaiax (so .well-known endpoints work)
    let mut wizard = default_state(&org_id);
    wizard.public_key_jwk = Some(jwk_str);
    wizard.cert_chain_pem = Some(cert_chain_pem);
    wizard.domain = Some(domain.clone());
    wizard.current_step = 2;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    // 7. Request LRN credential from GXDCH Notary
    let client = match gxdch_client(30) { Ok(c) => c, Err(r) => return r };
    let lrn_vc = match gxdch::request_lrn_credential(
        &client,
        &state.gaia_x.gxdch_notary_url,
        &domain,
        registration_number_type,
        registration_number,
    ).await {
        Ok(vc) => vc,
        Err(e) => fail!("lrn_request", format!("GXDCH Notary error: {e}")),
    };

    let lrn_str = serde_json::to_string(&lrn_vc).unwrap_or_default();
    wizard.lrn_credential = Some(lrn_str);
    wizard.lrn_type = Some(registration_number_type.clone());
    wizard.lrn_value = Some(registration_number.clone());
    wizard.current_step = 3;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    // 8. Assemble + sign Legal Participant credential
    let mut lp_cred = credentials::assemble_legal_participant(
        &domain,
        legal_name,
        country_subdivision_code,
    );
    if let Err(e) = signing::sign_credential(&mut lp_cred, &private_key_pem, &domain) {
        fail!("lp_signing", format!("LP signing failed: {e}"));
    }
    let lp_str = serde_json::to_string(&lp_cred).unwrap_or_default();
    wizard.lp_credential = Some(lp_str);
    wizard.current_step = 4;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    // 9. Assemble + sign Terms & Conditions credential
    let mut tc_cred = credentials::assemble_terms_conditions(&domain);
    if let Err(e) = signing::sign_credential(&mut tc_cred, &private_key_pem, &domain) {
        fail!("tc_signing", format!("T&C signing failed: {e}"));
    }
    let tc_str = serde_json::to_string(&tc_cred).unwrap_or_default();
    wizard.tc_credential = Some(tc_str);
    wizard.current_step = 5;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    // 10. Assemble VP and submit to GXDCH Compliance Service
    let vp_value = vp::assemble_vp(&lrn_vc, &lp_cred, &tc_cred);
    let compliance_client = match gxdch_client(60) { Ok(c) => c, Err(r) => return r };
    let compliance_vc = match gxdch::submit_compliance(
        &compliance_client,
        &state.gaia_x.gxdch_compliance_url,
        &vp_value,
    ).await {
        Ok(vc) => vc,
        Err(e) => fail!("compliance_submission", format!("GXDCH Compliance error: {e}")),
    };

    // 11. Save compliance VC, set wizard_step=6
    let vc_str = serde_json::to_string(&compliance_vc).unwrap_or_default();
    wizard.compliance_vc = Some(vc_str);
    wizard.current_step = 6;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    // 12. Return success
    data_response(ComplyResponse {
        compliant: true,
        private_key_pem: Some(private_key_pem),
        compliance_vc: Some(compliance_vc),
        error: None,
        failed_phase: None,
    }).into_response()
}

// ── j) GET /.well-known/did.json ──────────────────────────────────────────────

#[utoipa::path(get, path = "/.well-known/did.json", tag = "Gaia-X Public",
    params(("org" = Option<String>, Query, description = "Organization ID (dev fallback)")),
    responses(
        (status = 200, description = "DID document"),
        (status = 404, description = "DID document not found"),
    )
)]
pub async fn get_did_document(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let org_id = match resolve_org_id_from_request(&state, &headers, &params).await {
        Ok(id) => id,
        Err(r) => return r,
    };

    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "DID document not configured")),
            )
                .into_response()
        }
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };

    // Get domain: from wizard state or derive from org slug + base_domain
    let domain = if let Some(d) = wizard.domain.as_ref() {
        d.clone()
    } else if let Some(base_domain) = &state.gaia_x.base_domain {
        match conn.query_row(
            "SELECT slug FROM organizations WHERE id = ?1",
            rusqlite::params![&org_id],
            |row| Ok(row.get::<_, String>(0)?),
        ).optional() {
            Ok(Some(slug)) => format!("{}.{}", slug, base_domain),
            _ => return (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "Domain not configured")),
            ).into_response(),
        }
    } else {
        return (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "Domain not configured")),
        ).into_response();
    };

    // Get public key JWK
    let public_key_jwk_str = match wizard.public_key_jwk.as_ref() {
        Some(s) => s.clone(),
        None => return (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "DID document not configured — complete wizard steps first")),
        ).into_response(),
    };

    let public_key_jwk: Value = match serde_json::from_str(&public_key_jwk_str) {
        Ok(v) => v,
        Err(e) => return internal_error_response(&format!("failed to parse stored JWK: {e}")),
    };

    // Assemble DID document in memory
    let cert_url = format!("https://{}/.well-known/x509CertificateChain.pem", domain);
    let did = format!("did:web:{domain}");
    let key_id = format!("did:web:{domain}#key-1");

    let mut pub_jwk_with_x5u = public_key_jwk.clone();
    if let Some(obj) = pub_jwk_with_x5u.as_object_mut() {
        obj.insert("x5u".to_string(), serde_json::Value::String(cert_url));
    }

    let did_document = serde_json::json!({
        "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/jws-2020/v1"
        ],
        "id": did,
        "verificationMethod": [{
            "id": key_id,
            "type": "JsonWebKey2020",
            "controller": did,
            "publicKeyJwk": pub_jwk_with_x5u
        }],
        "assertionMethod": [key_id],
        "authentication": [key_id]
    });

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        Json(did_document),
    )
        .into_response()
}

// ── k) GET /.well-known/x509CertificateChain.pem ──────────────────────────────

#[utoipa::path(get, path = "/.well-known/x509CertificateChain.pem", tag = "Gaia-X Public",
    params(("org" = Option<String>, Query, description = "Organization ID (dev fallback)")),
    responses(
        (status = 200, description = "X.509 certificate chain PEM"),
        (status = 404, description = "Certificate chain not found"),
    )
)]
pub async fn get_cert_chain(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let org_id = match resolve_org_id_from_request(&state, &headers, &params).await {
        Ok(id) => id,
        Err(r) => return r,
    };

    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, "Certificate chain not found".to_string())
                .into_response()
        }
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };

    let cert_pem = match wizard.cert_chain_pem {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                "Certificate chain not configured".to_string(),
            )
                .into_response()
        }
    };

    (
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            "application/x-pem-file",
        )],
        cert_pem,
    )
        .into_response()
}
