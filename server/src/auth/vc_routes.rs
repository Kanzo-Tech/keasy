use std::sync::atomic::Ordering;
use axum::extract::State;
use axum::response::IntoResponse;
use serde_json::json;
use tower_sessions::Session;
use tower_sessions::Expiry;
use time::OffsetDateTime;

use crate::AppState;
use crate::error::data_response;
use super::errors::AuthError;
use super::vc_client;

/// POST /v1/auth/vc-init
///
/// Initiates an OID4VP verification session with the walt.id Verifier.
/// Returns { session_id, qr_url } for the frontend to render a QR code.
/// Returns 503 if the Verifier sidecar is unavailable.
pub async fn vc_init(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AuthError> {
    // Guard: sidecar must be available
    if !state.vc_available.load(Ordering::Relaxed) {
        return Err(AuthError::VcUnavailable);
    }

    let client = state.vc_client.as_ref()
        .ok_or_else(|| AuthError::Internal("VC client not configured".into()))?;

    let verifier_url = std::env::var("KEASY_WALT_ID_VERIFIER_URL")
        .unwrap_or_else(|_| "http://localhost:7003".to_string());

    let body = vc_client::create_verification_session(client, &verifier_url)
        .await
        .map_err(AuthError::Internal)?;

    Ok(data_response(json!({
        "session_id": body["id"],
        "qr_url": body["url"],
    })))
}

/// GET /v1/auth/vc-status/{session_id}
///
/// Polls the Verifier for the OID4VP session result.
/// If verification succeeded, creates a server-side session (identical to email/password login)
/// and returns { status: "authenticated", user_id }.
/// If pending, returns { status: "pending" }.
/// If session expired (404 from Verifier), returns { status: "expired" }.
pub async fn vc_status(
    session: Session,
    State(state): State<AppState>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> Result<impl IntoResponse, AuthError> {
    let client = state.vc_client.as_ref()
        .ok_or_else(|| AuthError::Internal("VC client not configured".into()))?;

    let verifier_url = std::env::var("KEASY_WALT_ID_VERIFIER_URL")
        .unwrap_or_else(|_| "http://localhost:7003".to_string());

    let body = vc_client::poll_session_status(client, &verifier_url, &session_id)
        .await
        .map_err(AuthError::Internal)?;

    // Check for expired session
    if body.get("status").and_then(|s| s.as_str()) == Some("expired") {
        return Ok(data_response(json!({ "status": "expired" })));
    }

    // Check verification result
    if body.get("verificationResult").and_then(|v| v.as_bool()).unwrap_or(false) {
        let holder_did = vc_client::extract_holder_did(&body);

        // Find user by DID — must be an existing account (no auto-creation; invite-only model)
        let user_id = match state.db.get_user_by_did(&holder_did).await {
            Some(user) => user.id,
            None => {
                return Err(AuthError::ValidationFailed(
                    "No Keasy account is linked to this credential. Please link your DID from your account settings, or log in with email/password first.".to_string()
                ));
            }
        };

        // Create session — IDENTICAL to email/password login in auth/routes.rs
        session.cycle_id().await
            .map_err(|e| AuthError::Internal(format!("cycle_id failed: {e}")))?;
        session.insert("user_id", user_id.clone()).await
            .map_err(|e| AuthError::Internal(format!("session insert failed: {e}")))?;
        session.insert("auth_method", "vc").await
            .map_err(|e| AuthError::Internal(format!("session insert auth_method failed: {e}")))?;
        session.set_expiry(Some(Expiry::AtDateTime(
            OffsetDateTime::now_utc() + time::Duration::hours(24),
        )));
        session.save().await
            .map_err(|e| AuthError::Internal(format!("session save failed: {e}")))?;

        let sid = session.id()
            .ok_or_else(|| AuthError::Internal("session has no ID after save".into()))?
            .to_string();
        state.db.upsert_user_session(&user_id, &sid).await
            .map_err(|e| AuthError::Internal(format!("upsert_user_session failed: {e}")))?;

        // Update org vc_verified_at timestamp (best-effort — non-fatal)
        if let Some(membership) = state.db.get_user_org_membership(&user_id).await {
            let _ = state.db.update_org_vc_verified_at(&membership.org_id).await;
        }

        return Ok(data_response(json!({
            "status": "authenticated",
            "user_id": user_id,
        })));
    }

    // Verification pending
    Ok(data_response(json!({ "status": "pending" })))
}

/// GET /v1/auth/vc-health
///
/// Returns whether the walt.id Verifier sidecar is available.
/// This is a public endpoint (no session required) consumed by the login page
/// to show/hide the VC login option.
pub async fn vc_health(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let available = state.vc_available.load(Ordering::Relaxed);
    data_response(json!({ "vc_available": available }))
}
