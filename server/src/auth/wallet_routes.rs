use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::AppState;
use crate::error::data_response;
use super::errors::AuthError;
use super::vc_client;

#[derive(Deserialize)]
pub struct ConnectPayload {
    pub session_id: String,
}

/// GET /v1/auth/wallet — returns current wallet connection status
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

/// POST /v1/auth/vc-connect — save wallet DID after successful OID4VP session
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

/// DELETE /v1/auth/wallet — disconnect wallet
pub async fn disconnect_wallet(
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    state.db.unlink_did_from_user(&auth_user.user_id)
        .await
        .map_err(|e| AuthError::Internal(format!("DB error: {e}")))?;

    Ok(data_response(json!({ "connected": false })))
}
