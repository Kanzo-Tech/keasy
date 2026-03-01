/// Axum route handlers for the Gaia-X compliance wizard.
///
/// All wizard endpoints are session + tenant protected.
/// The .well-known endpoints are public (no auth required).
use axum::response::IntoResponse;
use axum::{Json, extract::State};
use jiff::Timestamp;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use rusqlite::OptionalExtension;

use crate::AppState;
use crate::error::{data_response, error_body};
use crate::gaia_x::{WizardState, cert, credentials, db, gxdch, keys, signing, vp};
use crate::middleware::tenant::RequireParticipant;

use axum::http::StatusCode;
use axum::response::Response;

// ── Payload types ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CertUploadPayload {
    pub cert_chain_pem: String,
    pub domain: String,
}

#[derive(Deserialize)]
pub struct LrnPayload {
    pub lrn_type: String,
    pub lrn_value: String,
}

#[derive(Deserialize)]
pub struct LpPayload {
    pub legal_name: String,
    pub country_code: String,
    pub private_key_pem: String,
}

#[derive(Deserialize)]
pub struct TcPayload {
    pub private_key_pem: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    Timestamp::now().to_string()
}

fn internal_error(msg: &str) -> Response {
    tracing::error!("{}", msg);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(error_body("internal_error", "An internal error occurred")),
    )
        .into_response()
}

fn bad_request(msg: impl Into<String>) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(error_body("bad_request", msg)),
    )
        .into_response()
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

// ── a) GET /v1/gaia-x/wizard ──────────────────────────────────────────────────

/// Return the current wizard state for the authenticated org.
/// Returns a default (empty, step 0) state if no record exists yet.
pub async fn get_wizard_state(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;
    match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(wizard)) => data_response(wizard).into_response(),
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
            data_response(ws).into_response()
        }
        Err(e) => internal_error(&format!("failed to load wizard state: {e}")),
    }
}

// ── b) POST /v1/gaia-x/wizard/keys ───────────────────────────────────────────

/// Generate a P-256 key pair.
/// Returns { private_key_pem, public_key_jwk }.
/// The private key is returned once for download — NEVER stored in DB.
pub async fn generate_keys(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let pair = match keys::generate_key_pair() {
        Ok(p) => p,
        Err(e) => return internal_error(&format!("key generation failed: {e}")),
    };

    let jwk_str = match serde_json::to_string(&pair.public_key_jwk) {
        Ok(s) => s,
        Err(e) => return internal_error(&format!("failed to serialize JWK: {e}")),
    };

    let org_id = ctx.org_id.0.clone();
    let conn = state.db.write().await;
    let existing = match db::get_wizard_state(&conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error(&format!("db read failed: {e}")),
    };
    let mut wizard = existing.unwrap_or_else(|| default_state(&org_id));
    wizard.public_key_jwk = Some(jwk_str);
    if wizard.current_step < 1 {
        wizard.current_step = 1;
    }
    wizard.updated_at = now_iso();

    if let Err(e) = db::upsert_wizard_state(&conn, &wizard) {
        return internal_error(&format!("failed to save wizard state: {e}"));
    }

    data_response(serde_json::json!({
        "private_key_pem": pair.private_key_pem,
        "public_key_jwk": pair.public_key_jwk
    }))
    .into_response()
}

// ── c) POST /v1/gaia-x/wizard/certificate ────────────────────────────────────

/// Validate uploaded certificate chain and assemble DID document.
/// VC-05: cert chain is validated here (called at every step).
pub async fn validate_certificate(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<CertUploadPayload>,
) -> Response {
    // VC-05: validate chain
    if let Err(e) = cert::validate_chain(&payload.cert_chain_pem) {
        return bad_request(e.0);
    }

    let org_id = ctx.org_id.0.clone();

    // Load existing state to get stored public key JWK.
    let (_permit, read_conn) = state.db.read().await;
    let existing = match db::get_wizard_state(&read_conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error(&format!("db read failed: {e}")),
    };
    drop(read_conn);
    drop(_permit);

    let stored_jwk_str = match existing.as_ref().and_then(|s| s.public_key_jwk.as_ref()) {
        Some(j) => j.clone(),
        None => return bad_request("Key pair not generated yet — complete step 1 first"),
    };

    let public_key_jwk: Value = match serde_json::from_str(&stored_jwk_str) {
        Ok(v) => v,
        Err(e) => return internal_error(&format!("failed to parse stored JWK: {e}")),
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
        Err(e) => return internal_error(&format!("failed to serialize DID document: {e}")),
    };

    // Persist.
    let conn = state.db.write().await;
    let existing2 = match db::get_wizard_state(&conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error(&format!("db read for write failed: {e}")),
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
        return internal_error(&format!("failed to save wizard state: {e}"));
    }

    data_response(serde_json::json!({
        "ok": true,
        "did_document": did_document,
        "domain_warning": domain_warning
    }))
    .into_response()
}

// ── d) POST /v1/gaia-x/wizard/lrn ────────────────────────────────────────────

/// Request a signed LRN Verifiable Credential from the GXDCH Notary.
/// VC-05: cert chain re-validated before proceeding.
pub async fn request_lrn(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<LrnPayload>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => return bad_request("Wizard not started — complete previous steps first"),
        Err(e) => return internal_error(&format!("db read failed: {e}")),
    };
    drop(conn);
    drop(_permit);

    // VC-05: re-validate cert chain at this step
    let cert_pem = match &wizard.cert_chain_pem {
        Some(p) => p.clone(),
        None => return bad_request("Certificate not uploaded — complete step 2 first"),
    };
    if let Err(e) = cert::validate_chain(&cert_pem) {
        return bad_request(format!("Certificate validation failed: {}", e.0));
    }

    let domain = match &wizard.domain {
        Some(d) => d.clone(),
        None => return bad_request("Domain not set — complete step 2 first"),
    };

    // Build a reqwest client (use vc_client if available, otherwise build ad-hoc).
    let client = match &state.gaia_x.vc_client {
        Some(c) => c.clone(),
        None => match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
        {
            Ok(c) => c,
            Err(e) => return internal_error(&format!("failed to create HTTP client: {e}")),
        },
    };

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
        Err(e) => return internal_error(&format!("failed to serialize LRN VC: {e}")),
    };

    let write_conn = state.db.write().await;
    let existing = match db::get_wizard_state(&write_conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error(&format!("db read for write failed: {e}")),
    };
    let mut w = existing.unwrap_or_else(|| default_state(&org_id));
    w.lrn_credential = Some(lrn_str);
    w.lrn_type = Some(payload.lrn_type.clone());
    w.lrn_value = Some(payload.lrn_value.clone());
    if w.current_step < 3 {
        w.current_step = 3;
    }
    w.updated_at = now_iso();

    if let Err(e) = db::upsert_wizard_state(&write_conn, &w) {
        return internal_error(&format!("failed to save wizard state: {e}"));
    }

    data_response(lrn_vc).into_response()
}

// ── e) POST /v1/gaia-x/wizard/legal-participant ───────────────────────────────

/// Assemble, sign, and store the LegalParticipant Verifiable Credential.
/// The private key is accepted in-memory for signing and immediately dropped.
/// VC-05: cert chain re-validated.
pub async fn sign_legal_participant(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<LpPayload>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => return bad_request("Wizard not started — complete previous steps first"),
        Err(e) => return internal_error(&format!("db read failed: {e}")),
    };
    drop(conn);
    drop(_permit);

    // VC-05: re-validate cert chain
    let cert_pem = match &wizard.cert_chain_pem {
        Some(p) => p.clone(),
        None => return bad_request("Certificate not uploaded — complete step 2 first"),
    };
    if let Err(e) = cert::validate_chain(&cert_pem) {
        return bad_request(format!("Certificate validation failed: {}", e.0));
    }

    let domain = match &wizard.domain {
        Some(d) => d.clone(),
        None => return bad_request("Domain not set — complete step 2 first"),
    };

    // Verify private key matches stored public key.
    let stored_jwk: Value = match wizard.public_key_jwk.as_ref() {
        Some(j) => match serde_json::from_str(j) {
            Ok(v) => v,
            Err(e) => return internal_error(&format!("failed to parse stored JWK: {e}")),
        },
        None => return bad_request("Key pair not generated yet — complete step 1 first"),
    };

    if let Err(e) = keys::verify_key_match(&payload.private_key_pem, &stored_jwk) {
        return bad_request(e);
    }

    // Assemble LP credential and sign in-memory.
    let mut lp_cred = credentials::assemble_legal_participant(
        &domain,
        &payload.legal_name,
        &payload.country_code,
    );

    if let Err(e) = signing::sign_credential(&mut lp_cred, &payload.private_key_pem, &domain) {
        return internal_error(&format!("signing failed: {e}"));
    }
    // private_key_pem is dropped when `payload` is dropped at end of scope — never stored.

    let lp_str = match serde_json::to_string(&lp_cred) {
        Ok(s) => s,
        Err(e) => return internal_error(&format!("failed to serialize LP credential: {e}")),
    };

    let write_conn = state.db.write().await;
    let existing = match db::get_wizard_state(&write_conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error(&format!("db read for write failed: {e}")),
    };
    let mut w = existing.unwrap_or_else(|| default_state(&org_id));
    w.lp_credential = Some(lp_str);
    w.legal_name = Some(payload.legal_name.clone());
    w.country_code = Some(payload.country_code.clone());
    if w.current_step < 4 {
        w.current_step = 4;
    }
    w.updated_at = now_iso();

    if let Err(e) = db::upsert_wizard_state(&write_conn, &w) {
        return internal_error(&format!("failed to save wizard state: {e}"));
    }

    data_response(lp_cred).into_response()
}

// ── f) POST /v1/gaia-x/wizard/terms ──────────────────────────────────────────

/// Assemble, sign, and store the T&C Verifiable Credential.
/// The private key is accepted in-memory for signing and immediately dropped.
/// VC-05: cert chain re-validated.
pub async fn sign_terms_conditions(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<TcPayload>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => return bad_request("Wizard not started — complete previous steps first"),
        Err(e) => return internal_error(&format!("db read failed: {e}")),
    };
    drop(conn);
    drop(_permit);

    // VC-05: re-validate cert chain
    let cert_pem = match &wizard.cert_chain_pem {
        Some(p) => p.clone(),
        None => return bad_request("Certificate not uploaded — complete step 2 first"),
    };
    if let Err(e) = cert::validate_chain(&cert_pem) {
        return bad_request(format!("Certificate validation failed: {}", e.0));
    }

    let domain = match &wizard.domain {
        Some(d) => d.clone(),
        None => return bad_request("Domain not set — complete step 2 first"),
    };

    // Verify private key matches stored public key.
    let stored_jwk: Value = match wizard.public_key_jwk.as_ref() {
        Some(j) => match serde_json::from_str(j) {
            Ok(v) => v,
            Err(e) => return internal_error(&format!("failed to parse stored JWK: {e}")),
        },
        None => return bad_request("Key pair not generated yet — complete step 1 first"),
    };

    if let Err(e) = keys::verify_key_match(&payload.private_key_pem, &stored_jwk) {
        return bad_request(e);
    }

    let mut tc_cred = credentials::assemble_terms_conditions(&domain);

    if let Err(e) = signing::sign_credential(&mut tc_cred, &payload.private_key_pem, &domain) {
        return internal_error(&format!("signing failed: {e}"));
    }
    // private_key_pem dropped here — never stored.

    let tc_str = match serde_json::to_string(&tc_cred) {
        Ok(s) => s,
        Err(e) => return internal_error(&format!("failed to serialize T&C credential: {e}")),
    };

    let write_conn = state.db.write().await;
    let existing = match db::get_wizard_state(&write_conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error(&format!("db read for write failed: {e}")),
    };
    let mut w = existing.unwrap_or_else(|| default_state(&org_id));
    w.tc_credential = Some(tc_str);
    if w.current_step < 5 {
        w.current_step = 5;
    }
    w.updated_at = now_iso();

    if let Err(e) = db::upsert_wizard_state(&write_conn, &w) {
        return internal_error(&format!("failed to save wizard state: {e}"));
    }

    data_response(tc_cred).into_response()
}

// ── g) POST /v1/gaia-x/wizard/submit ─────────────────────────────────────────

/// Assemble VP and submit to GXDCH Compliance Service.
/// VC-05: cert chain re-validated.
/// VC-07: VP assembles all credentials as inline objects.
pub async fn submit_gxdch(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return bad_request("Wizard not started — complete all previous steps first")
        }
        Err(e) => return internal_error(&format!("db read failed: {e}")),
    };
    drop(conn);
    drop(_permit);

    // VC-05: re-validate cert chain
    let cert_pem = match &wizard.cert_chain_pem {
        Some(p) => p.clone(),
        None => return bad_request("Certificate not uploaded — complete step 2 first"),
    };
    if let Err(e) = cert::validate_chain(&cert_pem) {
        return bad_request(format!("Certificate validation failed: {}", e.0));
    }

    // Verify all 3 credentials exist.
    let lrn: Value = match wizard.lrn_credential.as_ref() {
        Some(s) => match serde_json::from_str(s) {
            Ok(v) => v,
            Err(e) => return internal_error(&format!("failed to parse LRN credential: {e}")),
        },
        None => return bad_request("LRN credential missing — complete step 3 first"),
    };
    let lp: Value = match wizard.lp_credential.as_ref() {
        Some(s) => match serde_json::from_str(s) {
            Ok(v) => v,
            Err(e) => {
                return internal_error(&format!("failed to parse LP credential: {e}"))
            }
        },
        None => return bad_request("Legal Participant credential missing — complete step 4 first"),
    };
    let tc: Value = match wizard.tc_credential.as_ref() {
        Some(s) => match serde_json::from_str(s) {
            Ok(v) => v,
            Err(e) => {
                return internal_error(&format!("failed to parse T&C credential: {e}"))
            }
        },
        None => return bad_request("T&C credential missing — complete step 5 first"),
    };

    // VC-07: assemble VP with inline credentials.
    let vp_value = vp::assemble_vp(&lrn, &lp, &tc);

    let client = match &state.gaia_x.vc_client {
        Some(c) => c.clone(),
        None => match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
        {
            Ok(c) => c,
            Err(e) => return internal_error(&format!("failed to create HTTP client: {e}")),
        },
    };

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
        Err(e) => return internal_error(&format!("failed to serialize compliance VC: {e}")),
    };

    let now = now_iso();
    let write_conn = state.db.write().await;
    let existing = match db::get_wizard_state(&write_conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error(&format!("db read for write failed: {e}")),
    };
    let mut w = existing.unwrap_or_else(|| default_state(&org_id));
    w.compliance_vc = Some(vc_str);
    w.current_step = 6;
    w.updated_at = now.clone();

    if let Err(e) = db::upsert_wizard_state(&write_conn, &w) {
        return internal_error(&format!("failed to save wizard state: {e}"));
    }

    // Update org's vc_verified_at.
    if let Err(e) = write_conn.execute(
        "UPDATE organizations SET vc_verified_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, org_id],
    ) {
        tracing::warn!("failed to update vc_verified_at: {e}");
    }

    // Sync wizard identity fields back to organization
    if let (Some(legal_name), Some(country_code)) = (&w.legal_name, &w.country_code) {
        let country_2 = &country_code[..std::cmp::min(2, country_code.len())];
        let _ = write_conn.execute(
            "UPDATE organizations SET legal_name = ?1, country = ?2, registration_number = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![legal_name, country_2, &w.lrn_value, &now, &org_id],
        );
    }

    data_response(serde_json::json!({
        "compliant": true,
        "compliance_vc": compliance_vc
    }))
    .into_response()
}

// ── h) GET /v1/gaia-x/compliance ─────────────────────────────────────────────

/// Return compliance status and credential inventory for the authenticated org.
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
        Err(e) => return internal_error(&format!("db read failed: {e}")),
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

/// Re-assemble VP from stored credentials and re-submit to GXDCH.
pub async fn rerun_compliance(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();
    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => return bad_request("No wizard state — complete the wizard first"),
        Err(e) => return internal_error(&format!("db read failed: {e}")),
    };
    drop(conn);
    drop(_permit);

    let lrn: Value = match wizard.lrn_credential.as_ref() {
        Some(s) => serde_json::from_str(s).unwrap_or_default(),
        None => return bad_request("LRN credential missing"),
    };
    let lp: Value = match wizard.lp_credential.as_ref() {
        Some(s) => serde_json::from_str(s).unwrap_or_default(),
        None => return bad_request("Legal Participant credential missing"),
    };
    let tc: Value = match wizard.tc_credential.as_ref() {
        Some(s) => serde_json::from_str(s).unwrap_or_default(),
        None => return bad_request("T&C credential missing"),
    };

    let vp_value = vp::assemble_vp(&lrn, &lp, &tc);

    let client = match &state.gaia_x.vc_client {
        Some(c) => c.clone(),
        None => match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
        {
            Ok(c) => c,
            Err(e) => return internal_error(&format!("failed to create HTTP client: {e}")),
        },
    };

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
        Err(e) => return internal_error(&format!("failed to serialize compliance VC: {e}")),
    };

    let now = now_iso();
    let write_conn = state.db.write().await;
    let existing = match db::get_wizard_state(&write_conn, &org_id) {
        Ok(e) => e,
        Err(e) => return internal_error(&format!("db read for write failed: {e}")),
    };
    let mut w = existing.unwrap_or_else(|| default_state(&org_id));
    w.compliance_vc = Some(vc_str);
    w.updated_at = now.clone();

    if let Err(e) = db::upsert_wizard_state(&write_conn, &w) {
        return internal_error(&format!("failed to save wizard state: {e}"));
    }

    if let Err(e) = write_conn.execute(
        "UPDATE organizations SET vc_verified_at = ?1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, org_id],
    ) {
        tracing::warn!("failed to update vc_verified_at: {e}");
    }

    // Sync wizard identity fields back to organization
    if let (Some(legal_name), Some(country_code)) = (&w.legal_name, &w.country_code) {
        let country_2 = &country_code[..std::cmp::min(2, country_code.len())];
        let _ = write_conn.execute(
            "UPDATE organizations SET legal_name = ?1, country = ?2, registration_number = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![legal_name, country_2, &w.lrn_value, &now, &org_id],
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

/// Public endpoint: serve the DID document for an org.
///
/// NOTE: Since did:web resolution uses the domain, and Keasy is single-domain,
/// the .well-known endpoint uses a query param `?org={org_id}` to identify
/// which org's DID document to serve. In a multi-tenant SaaS deployment each
/// org would typically use a sub-domain; this is a known limitation.
pub async fn get_did_document(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let org_id = match params.get("org") {
        Some(id) => id.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_body(
                    "bad_request",
                    "Missing ?org=<org_id> query parameter",
                )),
            )
                .into_response()
        }
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
        Err(e) => return internal_error(&format!("db read failed: {e}")),
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
        Err(e) => return internal_error(&format!("failed to parse DID document: {e}")),
    };

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        Json(did_doc),
    )
        .into_response()
}

// ── k) GET /.well-known/x509CertificateChain.pem ──────────────────────────────

/// Public endpoint: serve the X.509 certificate chain PEM for an org.
/// See `get_did_document` for notes on the ?org= query param pattern.
pub async fn get_cert_chain(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<HashMap<String, String>>,
) -> Response {
    let org_id = match params.get("org") {
        Some(id) => id.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_body(
                    "bad_request",
                    "Missing ?org=<org_id> query parameter",
                )),
            )
                .into_response()
        }
    };

    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, "Certificate chain not found".to_string())
                .into_response()
        }
        Err(e) => return internal_error(&format!("db read failed: {e}")),
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
