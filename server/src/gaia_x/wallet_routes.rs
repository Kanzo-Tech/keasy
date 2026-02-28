use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::error::data_response;
use super::vc_client;

#[derive(Deserialize)]
pub struct ConnectPayload {
    pub session_id: String,
}

/// POST /v1/gaia-x/wallet/vc-init — start an OID4VP session for wallet connection.
///
/// Creates a verification session with the walt.id Verifier and returns
/// { session_id, qr_url } for the frontend to render a QR code.
/// Session-protected: only authenticated users can link a wallet.
pub async fn init_wallet_session(
    State(state): State<AppState>,
    _auth_user: axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    let client = state.vc_client.as_ref()
        .ok_or(AuthError::VcUnavailable)?;

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

/// GET /v1/gaia-x/wallet/vc-status/{session_id} — poll OID4VP session for wallet connection.
///
/// Returns { status: "pending" | "authenticated" | "expired" }.
/// The frontend polls this until it gets "authenticated", then calls vc-connect.
pub async fn wallet_verify_status(
    State(state): State<AppState>,
    _auth_user: axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> Result<impl IntoResponse, AuthError> {
    let client = state.vc_client.as_ref()
        .ok_or(AuthError::VcUnavailable)?;

    let verifier_url = std::env::var("KEASY_WALT_ID_VERIFIER_URL")
        .unwrap_or_else(|_| "http://localhost:7003".to_string());

    let body = vc_client::poll_session_status(client, &verifier_url, &session_id)
        .await
        .map_err(AuthError::Internal)?;

    if body.get("status").and_then(|s| s.as_str()) == Some("expired") {
        return Ok(data_response(json!({ "status": "expired" })));
    }

    if body.get("verificationResult").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Ok(data_response(json!({ "status": "authenticated" })));
    }

    Ok(data_response(json!({ "status": "pending" })))
}

/// GET /v1/gaia-x/wallet — returns current wallet connection status
pub async fn get_wallet(
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    let user = state.db.get_user(&auth_user.user_id).await
        .ok_or(AuthError::Forbidden)?;
    Ok(data_response(json!({
        "connected": user.vc_holder_did.is_some(),
        "did": user.vc_holder_did,
        "connected_at": user.wallet_connected_at,
    })))
}

/// POST /v1/gaia-x/wallet/vc-connect — save wallet DID after successful OID4VP session
///
/// The frontend already polled vc-status and knows the session succeeded.
/// This endpoint re-polls the Verifier (defense-in-depth) to extract the holder DID,
/// then stores it on the user's account.
pub async fn save_wallet_connection(
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
    Json(payload): Json<ConnectPayload>,
) -> Result<impl IntoResponse, AuthError> {
    let client = state.vc_client.as_ref()
        .ok_or(AuthError::VcUnavailable)?;

    let verifier_url = std::env::var("KEASY_WALT_ID_VERIFIER_URL")
        .unwrap_or_else(|_| "http://localhost:7003".to_string());

    let body = vc_client::poll_session_status(client, &verifier_url, &payload.session_id)
        .await
        .map_err(AuthError::Internal)?;

    // Verify the session was actually successful
    if !body.get("verificationResult").and_then(|v| v.as_bool()).unwrap_or(false) {
        tracing::warn!(user_id = %auth_user.user_id, session_id = %payload.session_id, "vc-connect: verification not successful");
        return Err(AuthError::ValidationFailed("Wallet connection could not be verified".into()));
    }

    let holder_did = vc_client::extract_holder_did(&body);

    // Save DID to user account
    state.db.link_did_to_user(&auth_user.user_id, &holder_did)
        .await
        .map_err(|e| AuthError::Internal(format!("DB error: {e}")))?;

    // Update wallet_connected_at timestamp
    state.db.update_wallet_connected_at(&auth_user.user_id)
        .await
        .map_err(|e| AuthError::Internal(format!("DB error: {e}")))?;

    Ok(data_response(json!({
        "connected": true,
        "did": holder_did,
    })))
}

/// DELETE /v1/gaia-x/wallet — disconnect wallet
pub async fn disconnect_wallet(
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    state.db.unlink_did_from_user(&auth_user.user_id)
        .await
        .map_err(|e| AuthError::Internal(format!("DB error: {e}")))?;

    Ok(data_response(json!({ "connected": false })))
}
