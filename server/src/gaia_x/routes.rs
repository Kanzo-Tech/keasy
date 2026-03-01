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
use crate::gaia_x::{WizardState, cert, credentials, db, gxdch, keys, signing, vp};
use crate::middleware::tenant::RequireParticipant;

use axum::http::StatusCode;
use axum::response::Response;

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

#[derive(Deserialize, utoipa::ToSchema)]
pub struct LpPayload {
    pub legal_name: String,
    pub country_code: String,
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
        did_document: None,
        lrn_credential: None,
        lp_credential: None,
        tc_credential: None,
        compliance_vc: None,
        lrn_type: None,
        lrn_value: None,
        legal_name: None,
        country_code: None,
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

/// Save the wizard state to DB, upserting if needed.
async fn save_wizard_step(state: &AppState, wizard: &WizardState) -> Result<(), Response> {
    let conn = state.db.write().await;
    let existing = db::get_wizard_state(&conn, &wizard.org_id)
        .map_err(|e| internal_error_response(&format!("db read for write failed: {e}")))?;
    let mut w = existing.unwrap_or_else(|| default_state(&wizard.org_id));
    // Copy all fields from the incoming wizard state
    w.public_key_jwk = wizard.public_key_jwk.clone();
    w.cert_chain_pem = wizard.cert_chain_pem.clone();
    w.root_ca_pem = wizard.root_ca_pem.clone();
    w.did_document = wizard.did_document.clone();
    w.lrn_credential = wizard.lrn_credential.clone();
    w.lp_credential = wizard.lp_credential.clone();
    w.tc_credential = wizard.tc_credential.clone();
    w.compliance_vc = wizard.compliance_vc.clone();
    w.lrn_type = wizard.lrn_type.clone();
    w.lrn_value = wizard.lrn_value.clone();
    w.legal_name = wizard.legal_name.clone();
    w.country_code = wizard.country_code.clone();
    w.domain = wizard.domain.clone();
    if wizard.current_step > w.current_step {
        w.current_step = wizard.current_step;
    }
    w.updated_at = now_iso();
    db::upsert_wizard_state(&conn, &w)
        .map_err(|e| internal_error_response(&format!("failed to save wizard state: {e}")))?;
    Ok(())
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
fn gxdch_client(state: &AppState, timeout_secs: u64) -> Result<reqwest::Client, Response> {
    match &state.gaia_x.vc_client {
        Some(c) => Ok(c.clone()),
        None => reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| internal_error_response(&format!("failed to create HTTP client: {e}"))),
    }
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
    // Try Host header subdomain resolution first
    if let Some(base_domain) = &state.gaia_x.base_domain {
        if let Some(host) = headers.get(HOST).and_then(|h| h.to_str().ok()) {
            // Strip port if present (e.g. "acme-corp.keasy.example.com:3000")
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

    // Fallback: ?org= query param
    params.get("org").cloned().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", "Missing ?org=<org_id> query parameter")),
        ).into_response()
    })
}

// ── a) GET /v1/gaia-x/wizard ──────────────────────────────────────────────────

#[utoipa::path(get, path = "/v1/gaia-x/wizard", tag = "Gaia-X Compliance",
    responses((status = 200, description = "Current wizard state", body = WizardState))
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
                if let Ok(Some(org)) = conn.query_row(
                    "SELECT slug FROM organizations WHERE id = ?1",
                    rusqlite::params![&org_id],
                    |row| Ok(row.get::<_, String>(0)?),
                ).optional() {
                    ws.domain = Some(format!("{}.{}", org, base_domain));
                }
            }
        }
    };

    match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(mut wizard)) => {
            auto_fill_domain(&mut wizard);
            data_response(wizard).into_response()
        }
        Ok(None) => {
            let mut ws = default_state(&org_id);
            // Pre-fill from organization identity if available
            if let Ok(Some(org)) = conn.query_row(
                "SELECT legal_name, country, registration_number FROM organizations WHERE id = ?1",
                rusqlite::params![&org_id],
                |row| Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                )),
            ).optional() {
                let (ln, c, rn) = org;
                if !ln.is_empty() { ws.legal_name = Some(ln); }
                if !c.is_empty() { ws.country_code = Some(c); }
                if let Some(r) = rn { ws.lrn_value = Some(r); }
            }
            auto_fill_domain(&mut ws);
            data_response(ws).into_response()
        }
        Err(e) => internal_error_response(&format!("failed to load wizard state: {e}")),
    }
}

// ── b) POST /v1/gaia-x/wizard/keys ───────────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/keys", tag = "Gaia-X Compliance",
    responses((status = 200, description = "Generated key pair"))
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

    data_response(serde_json::json!({
        "private_key_pem": pair.private_key_pem,
        "public_key_jwk": pair.public_key_jwk
    }))
    .into_response()
}

// ── c) POST /v1/gaia-x/wizard/certificate ────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/certificate", tag = "Gaia-X Compliance",
    request_body = CertUploadPayload,
    responses(
        (status = 200, description = "Certificate validated and DID document assembled"),
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

    // Check domain warning (info-only, non-blocking).
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

    // Assemble DID document.
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

    let did_doc_str = match serde_json::to_string(&did_document) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize DID document: {e}")),
    };

    // Persist.
    let conn = state.db.write().await;
    let existing2 = match db::get_wizard_state(&conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error_response(&format!("db read for write failed: {e}")),
    };
    let mut wizard = existing2.unwrap_or_else(|| default_state(&org_id));
    wizard.cert_chain_pem = Some(payload.cert_chain_pem.clone());
    wizard.did_document = Some(did_doc_str);
    wizard.domain = Some(domain.to_string());
    if wizard.current_step < 2 {
        wizard.current_step = 2;
    }
    wizard.updated_at = now_iso();

    if let Err(e) = db::upsert_wizard_state(&conn, &wizard) {
        return internal_error_response(&format!("failed to save wizard state: {e}"));
    }

    data_response(serde_json::json!({
        "ok": true,
        "did_document": did_document,
        "domain_warning": domain_warning
    }))
    .into_response()
}

// ── d) POST /v1/gaia-x/wizard/lrn ────────────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/lrn", tag = "Gaia-X Compliance",
    request_body = LrnPayload,
    responses(
        (status = 200, description = "LRN credential obtained"),
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
    let client = match gxdch_client(&state, 30) { Ok(c) => c, Err(r) => return r };

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
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    data_response(lrn_vc).into_response()
}

// ── e) POST /v1/gaia-x/wizard/legal-participant ───────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/legal-participant", tag = "Gaia-X Compliance",
    request_body = LpPayload,
    responses(
        (status = 200, description = "Legal Participant credential signed"),
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
        &payload.legal_name,
        &payload.country_code,
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
    wizard.legal_name = Some(payload.legal_name.clone());
    wizard.country_code = Some(payload.country_code.clone());
    wizard.current_step = 4;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    data_response(lp_cred).into_response()
}

// ── f) POST /v1/gaia-x/wizard/terms ──────────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/terms", tag = "Gaia-X Compliance",
    request_body = TcPayload,
    responses(
        (status = 200, description = "Terms & Conditions credential signed"),
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

    let mut tc_cred = credentials::assemble_terms_conditions(&domain);

    if let Err(e) = signing::sign_credential(&mut tc_cred, &payload.private_key_pem, &domain) {
        return internal_error_response(&format!("signing failed: {e}"));
    }
    // private_key_pem dropped here — never stored.

    let tc_str = match serde_json::to_string(&tc_cred) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize T&C credential: {e}")),
    };

    wizard.tc_credential = Some(tc_str);
    wizard.current_step = 5;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    data_response(tc_cred).into_response()
}

// ── g) POST /v1/gaia-x/wizard/submit ─────────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/wizard/submit", tag = "Gaia-X Compliance",
    responses(
        (status = 200, description = "Compliance submission result"),
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

    // Verify all 3 credentials exist.
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

    // VC-07: assemble VP with inline credentials.
    let vp_value = vp::assemble_vp(&lrn, &lp, &tc);

    let client = match gxdch_client(&state, 60) { Ok(c) => c, Err(r) => return r };

    let compliance_vc = match gxdch::submit_compliance(
        &client,
        &state.gaia_x.gxdch_compliance_url,
        &vp_value,
    )
    .await
    {
        Ok(vc) => vc,
        Err(e) => {
            return data_response(serde_json::json!({
                "compliant": false,
                "error": e
            }))
            .into_response()
        }
    };

    let vc_str = match serde_json::to_string(&compliance_vc) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize compliance VC: {e}")),
    };

    let now = now_iso();
    wizard.compliance_vc = Some(vc_str);
    wizard.current_step = 6;
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    // Update org's vc_verified_at.
    let write_conn = state.db.write().await;
    if let Err(e) = write_conn.execute(
        "UPDATE organizations SET vc_verified_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, org_id],
    ) {
        tracing::warn!("failed to update vc_verified_at: {e}");
    }

    // Sync wizard identity fields back to organization
    if let (Some(legal_name), Some(country_code)) = (&wizard.legal_name, &wizard.country_code) {
        let country_2 = &country_code[..std::cmp::min(2, country_code.len())];
        let _ = write_conn.execute(
            "UPDATE organizations SET legal_name = ?1, country = ?2, registration_number = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![legal_name, country_2, &wizard.lrn_value, &now, &org_id],
        );
    }

    data_response(serde_json::json!({
        "compliant": true,
        "compliance_vc": compliance_vc
    }))
    .into_response()
}

// ── h) GET /v1/gaia-x/compliance ─────────────────────────────────────────────

#[utoipa::path(get, path = "/v1/gaia-x/compliance", tag = "Gaia-X Compliance",
    responses((status = 200, description = "Compliance status and credentials"))
)]
pub async fn get_compliance_status(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;

    let verified_at: Option<String> = conn
        .query_row(
            "SELECT vc_verified_at FROM organizations WHERE id = ?1",
            rusqlite::params![&org_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return data_response(serde_json::json!({
                "compliant": false,
                "verified_at": verified_at,
                "credentials": [],
                "wizard_state": null
            }))
            .into_response()
        }
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };

    let compliant = wizard.compliance_vc.is_some();

    // Build credential list.
    let credential_fields: &[(&str, &Option<String>)] = &[
        ("LRN Credential", &wizard.lrn_credential),
        ("Legal Participant Credential", &wizard.lp_credential),
        ("Terms & Conditions Credential", &wizard.tc_credential),
        ("Compliance VC", &wizard.compliance_vc),
    ];

    let mut creds: Vec<serde_json::Value> = Vec::new();
    for (name, field) in credential_fields {
        if let Some(raw) = field {
            let parsed: Value = serde_json::from_str(raw).unwrap_or_default();
            let issued_at = parsed
                .get("issuanceDate")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            creds.push(serde_json::json!({
                "name": name,
                "issued_at": issued_at,
                "raw_json": parsed
            }));
        }
    }

    data_response(serde_json::json!({
        "compliant": compliant,
        "verified_at": verified_at,
        "credentials": creds,
        "wizard_state": wizard
    }))
    .into_response()
}

// ── i) POST /v1/gaia-x/compliance/rerun ──────────────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/compliance/rerun", tag = "Gaia-X Compliance",
    responses(
        (status = 200, description = "Re-submitted compliance result"),
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
    let client = match gxdch_client(&state, 60) { Ok(c) => c, Err(r) => return r };

    let compliance_vc = match gxdch::submit_compliance(
        &client,
        &state.gaia_x.gxdch_compliance_url,
        &vp_value,
    )
    .await
    {
        Ok(vc) => vc,
        Err(e) => {
            return data_response(serde_json::json!({
                "compliant": false,
                "error": e
            }))
            .into_response()
        }
    };

    let vc_str = match serde_json::to_string(&compliance_vc) {
        Ok(s) => s,
        Err(e) => return internal_error_response(&format!("failed to serialize compliance VC: {e}")),
    };

    let now = now_iso();
    wizard.compliance_vc = Some(vc_str);
    if let Err(r) = save_wizard_step(&state, &wizard).await { return r; }

    let write_conn = state.db.write().await;
    if let Err(e) = write_conn.execute(
        "UPDATE organizations SET vc_verified_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, org_id],
    ) {
        tracing::warn!("failed to update vc_verified_at: {e}");
    }

    // Sync wizard identity fields back to organization
    if let (Some(legal_name), Some(country_code)) = (&wizard.legal_name, &wizard.country_code) {
        let country_2 = &country_code[..std::cmp::min(2, country_code.len())];
        let _ = write_conn.execute(
            "UPDATE organizations SET legal_name = ?1, country = ?2, registration_number = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![legal_name, country_2, &wizard.lrn_value, &now, &org_id],
        );
    }

    data_response(serde_json::json!({
        "compliant": true,
        "compliance_vc": compliance_vc,
        "verified_at": now
    }))
    .into_response()
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
                Json(error_body("not_found", "DID document not found")),
            )
                .into_response()
        }
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };

    let did_doc_str = match wizard.did_document {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "DID document not configured")),
            )
                .into_response()
        }
    };

    let did_doc: Value = match serde_json::from_str(&did_doc_str) {
        Ok(v) => v,
        Err(e) => return internal_error_response(&format!("failed to parse DID document: {e}")),
    };

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        Json(did_doc),
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
