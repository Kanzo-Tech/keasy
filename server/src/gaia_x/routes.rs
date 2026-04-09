/// Axum route handlers for Gaia-X compliance.
///
/// Handlers (4):
/// - `comply` — one-click compliance pipeline
/// - `get_compliance_status` — read current compliance state
/// - `get_did_document` — public .well-known/did.json
/// - `get_cert_chain` — public .well-known/x509CertificateChain.pem
use axum::response::IntoResponse;
use axum::response::sse::Event;
use axum::{Json, extract::State};
use axum::http::HeaderMap;
use axum::http::header::HOST;
use jiff::Timestamp;
use serde_json::Value;
use std::collections::HashMap;
use std::convert::Infallible;

use crate::sse::into_sse_response;

use crate::AppState;
use crate::error::{bad_request_response, data_response, error_body, internal_error_response};
use crate::gaia_x::{ComplyEvent, ComplyRequest, ComplyResponse, GaiaxState, cert, credentials, did_web, did_web_key, keys, signing, vp, well_known_url};
use crate::gaia_x::gxdch::MockGxdch;
use crate::middleware::tenant::{IsParticipant, Require};

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    Timestamp::now().to_string()
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
    if let Some(base_domain) = &state.gaia_x.base_domain
        && let Some(host) = headers.get(HOST).and_then(|h| h.to_str().ok()) {
            let host_no_port = host.split(':').next().unwrap_or(host);
            if let Some(slug) = host_no_port.strip_suffix(&format!(".{}", base_domain))
                && !slug.is_empty() && !slug.contains('.') {
                    if let Some(org) = state.repos.get_organization_by_slug(slug).await {
                        return Ok(org.id);
                    }
                    return Err((
                        StatusCode::NOT_FOUND,
                        Json(error_body("not_found", "Organization not found for subdomain")),
                    ).into_response());
                }
        }

    params.get("org").cloned().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", "Missing ?org=<org_id> query parameter")),
        ).into_response()
    })
}

// ── POST /v1/gaia-x/comply — One-click compliance ─────────────────────────────

#[utoipa::path(post, path = "/v1/gaia-x/comply", tag = "Gaia-X Compliance",
    request_body = ComplyRequest,
    responses(
        (status = 200, description = "SSE stream of compliance phases", body = ComplyEvent, content_type = "text/event-stream"),
        (status = 400, description = "Prerequisites missing"),
    )
)]
pub async fn comply(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(payload): Json<ComplyRequest>,
) -> Response {
    let org_id = ctx.org_id.0.clone();

    // ── Validate prerequisites synchronously (return JSON errors, not SSE) ──
    let org = match state.repos.get_organization(&org_id).await {
        Some(o) => o,
        None => return bad_request_response("Organization not found"),
    };

    let mut missing = Vec::new();
    if org.legal_name.trim().is_empty() { missing.push("legal_name"); }
    if org.country_subdivision_code.is_none() { missing.push("country_subdivision_code"); }
    if org.registration_number_type.is_none() { missing.push("registration_number_type"); }
    if org.registration_number.as_ref().is_none_or(|s| s.is_empty()) { missing.push("registration_number"); }
    if !missing.is_empty() {
        return bad_request_response(format!("Missing required fields: {}", missing.join(", ")));
    }

    let base_domain = match &state.gaia_x.base_domain {
        Some(bd) => bd.clone(),
        None => return bad_request_response("KEASY_BASE_DOMAIN is not configured"),
    };

    // ── Open SSE channel ────────────────────────────────────────────────────
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(8);

    let country_subdivision_code = org.country_subdivision_code.clone().unwrap();
    let registration_number_type = org.registration_number_type.clone().unwrap();
    let registration_number = org.registration_number.clone().unwrap();
    let legal_name = org.legal_name.clone();
    let slug = org.slug.clone();
    let cert_chain_pem_input = payload.cert_chain_pem.clone();

    tokio::spawn(async move {
        let domain = format!("{slug}.{base_domain}");

        // Helper: send a ComplyEvent as an SSE data frame.
        let emit = |tx: &tokio::sync::mpsc::Sender<Result<Event, Infallible>>, evt: ComplyEvent| {
            let json = serde_json::to_string(&evt).unwrap_or_default();
            let _ = tx.try_send(Ok(Event::default().data(json)));
        };

        // Helper: send error event and return early.
        macro_rules! fail_sse {
            ($tx:expr, $phase:expr, $index:expr, $msg:expr, $pk:expr) => {{
                emit(&$tx, ComplyEvent {
                    phase: $phase.to_string(),
                    index: $index,
                    error: Some($msg),
                    data: Some(ComplyResponse {
                        compliant: false,
                        private_key_pem: $pk,
                        compliance_vc: None,
                        error: Some($phase.to_string()),
                        failed_phase: Some($phase.to_string()),
                    }),
                });
                return;
            }};
        }

        // Phase 0: key_generation
        let pair = match keys::generate_key_pair() {
            Ok(p) => p,
            Err(e) => fail_sse!(tx, "key_generation", 0, format!("Key generation failed: {e}"), None),
        };
        let private_key_pem = pair.private_key_pem.clone();

        let jwk_str = match serde_json::to_string(&pair.public_key_jwk) {
            Ok(s) => s,
            Err(e) => fail_sse!(tx, "key_generation", 0, format!("Failed to serialize JWK: {e}"), Some(private_key_pem)),
        };

        emit(&tx, ComplyEvent { phase: "key_generation".into(), index: 0, error: None, data: None });

        // Phase 1: certificate
        let cert_chain_pem = if let Some(caddy_dir) = &state.gaia_x.caddy_certs_dir {
            match cert::read_caddy_cert_chain(caddy_dir, &base_domain) {
                Ok(pem) => pem,
                Err(_) => match cert_chain_pem_input {
                    Some(ref pem) if !pem.is_empty() => pem.clone(),
                    _ => fail_sse!(tx, "certificate", 1, "Could not read Caddy certificates and no cert_chain_pem provided".into(), Some(private_key_pem)),
                },
            }
        } else {
            match cert_chain_pem_input {
                Some(ref pem) if !pem.is_empty() => pem.clone(),
                _ => {
                    if state.gaia_x.gxdch.is_mock() {
                        tracing::warn!("[MOCK] No Caddy certs and no cert_chain_pem — generating self-signed certificate for {domain}");
                        match MockGxdch::generate_self_signed_cert(&domain) {
                            Ok(pem) => pem,
                            Err(e) => fail_sse!(tx, "certificate", 1, format!("Failed to generate self-signed cert: {e}"), Some(private_key_pem)),
                        }
                    } else {
                        fail_sse!(tx, "certificate", 1, "KEASY_CADDY_CERTS_DIR not configured and no cert_chain_pem provided".into(), Some(private_key_pem))
                    }
                }
            }
        };

        if let Err(e) = cert::validate_chain(&cert_chain_pem) {
            fail_sse!(tx, "certificate", 1, format!("Certificate validation failed: {}", e.0), Some(private_key_pem));
        }

        // Save keys + cert + domain (so .well-known endpoints work)
        let mut gx_state = GaiaxState {
            org_id: org_id.clone(),
            public_key_jwk: Some(jwk_str),
            cert_chain_pem: Some(cert_chain_pem),
            lrn_credential: None,
            lp_credential: None,
            tc_credential: None,
            compliance_vc: None,
            lrn_type: None,
            lrn_value: None,
            domain: Some(domain.clone()),
            updated_at: now_iso(),
        };
        if let Err(e) = state.repos.upsert_gaiax_state(&gx_state).await {
            fail_sse!(tx, "certificate", 1, format!("Failed to save gaiax state: {e}"), Some(private_key_pem));
        }

        emit(&tx, ComplyEvent { phase: "certificate".into(), index: 1, error: None, data: None });

        // Phase 2: lrn_request
        let lrn_vc = match state.gaia_x.gxdch.request_lrn_credential(
            &domain,
            &registration_number_type,
            &registration_number,
        ).await {
            Ok(vc) => vc,
            Err(e) => fail_sse!(tx, "lrn_request", 2, format!("GXDCH Notary error: {e}"), Some(private_key_pem)),
        };

        emit(&tx, ComplyEvent { phase: "lrn_request".into(), index: 2, error: None, data: None });

        // Phase 3: signing (LP + T&C)
        let mut lp_cred = credentials::assemble_legal_participant(
            &domain,
            &legal_name,
            &country_subdivision_code,
        );
        if let Err(e) = signing::sign_credential(&mut lp_cred, &private_key_pem, &domain) {
            fail_sse!(tx, "signing", 3, format!("LP signing failed: {e}"), Some(private_key_pem));
        }

        let mut tc_cred = credentials::assemble_terms_conditions(&domain);
        if let Err(e) = signing::sign_credential(&mut tc_cred, &private_key_pem, &domain) {
            fail_sse!(tx, "signing", 3, format!("T&C signing failed: {e}"), Some(private_key_pem));
        }

        emit(&tx, ComplyEvent { phase: "signing".into(), index: 3, error: None, data: None });

        // Phase 4: compliance_submission
        let vp_value = vp::assemble_vp(&lrn_vc, &lp_cred, &tc_cred);
        let compliance_vc = match state.gaia_x.gxdch.submit_compliance(&vp_value, &domain).await {
            Ok(vc) => vc,
            Err(e) => fail_sse!(tx, "compliance_submission", 4, format!("GXDCH Compliance error: {e}"), Some(private_key_pem)),
        };

        emit(&tx, ComplyEvent { phase: "compliance_submission".into(), index: 4, error: None, data: None });

        // Save all credentials to DB
        let lrn_str = serde_json::to_string(&lrn_vc).unwrap_or_default();
        let lp_str = serde_json::to_string(&lp_cred).unwrap_or_default();
        let tc_str = serde_json::to_string(&tc_cred).unwrap_or_default();
        let vc_str = serde_json::to_string(&compliance_vc).unwrap_or_default();
        gx_state.lrn_credential = Some(lrn_str);
        gx_state.lrn_type = Some(registration_number_type);
        gx_state.lrn_value = Some(registration_number);
        gx_state.lp_credential = Some(lp_str);
        gx_state.tc_credential = Some(tc_str);
        gx_state.compliance_vc = Some(vc_str);
        gx_state.updated_at = now_iso();
        if let Err(e) = state.repos.upsert_gaiax_state(&gx_state).await {
            tracing::error!("failed to save final gaiax state: {e}");
        }

        // Phase 5: complete
        emit(&tx, ComplyEvent {
            phase: "complete".into(),
            index: 5,
            error: None,
            data: Some(ComplyResponse {
                compliant: true,
                private_key_pem: Some(private_key_pem),
                compliance_vc: Some(compliance_vc),
                error: None,
                failed_phase: None,
            }),
        });
    });

    into_sse_response(rx)
}

// ── GET /v1/gaia-x/compliance ─────────────────────────────────────────────

#[utoipa::path(get, path = "/v1/gaia-x/compliance", tag = "Gaia-X Compliance",
    responses((status = 200, description = "Compliance status and credentials", body = ComplianceStatus))
)]
pub async fn get_compliance_status(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
) -> Response {
    let org_id = ctx.org_id.0.clone();

    let gx = match state.repos.get_gaiax_state(&org_id).await {
        Ok(Some(w)) => w,
        Ok(None) => {
            return data_response(ComplianceStatus {
                compliant: false,
                verified_at: None,
                credentials: vec![],
            })
            .into_response()
        }
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };

    let compliant = gx.compliance_vc.is_some();

    let credential_fields: &[(&str, &Option<String>)] = &[
        ("LRN Credential", &gx.lrn_credential),
        ("Legal Participant Credential", &gx.lp_credential),
        ("Terms & Conditions Credential", &gx.tc_credential),
        ("Compliance VC", &gx.compliance_vc),
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
    })
    .into_response()
}

// ── GET /.well-known/did.json ──────────────────────────────────────────────

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

    let gx = match state.repos.get_gaiax_state(&org_id).await {
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

    // Get domain: from state or derive from org slug + base_domain
    let domain = if let Some(d) = gx.domain.as_ref() {
        d.clone()
    } else if let Some(base_domain) = &state.gaia_x.base_domain {
        match state.repos.get_organization(&org_id).await {
            Some(org) => format!("{}.{}", org.slug, base_domain),
            None => return (
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
    let public_key_jwk_str = match gx.public_key_jwk.as_ref() {
        Some(s) => s.clone(),
        None => return (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "DID document not configured — run comply first")),
        ).into_response(),
    };

    let public_key_jwk: Value = match serde_json::from_str(&public_key_jwk_str) {
        Ok(v) => v,
        Err(e) => return internal_error_response(&format!("failed to parse stored JWK: {e}")),
    };

    // Assemble DID document in memory
    let cert_url = well_known_url(&domain, "x509CertificateChain.pem");
    let did = did_web(&domain);
    let key_id = did_web_key(&domain);

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

// ── GET /.well-known/x509CertificateChain.pem ──────────────────────────────

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

    let gx = match state.repos.get_gaiax_state(&org_id).await {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, "Certificate chain not found".to_string())
                .into_response()
        }
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };

    let cert_pem = match gx.cert_chain_pem {
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
