use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::error::data_response;
use crate::middleware::tenant::RequireOrgAdmin;
use super::vc_client;

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ConnectPayload {
    pub session_id: String,
}

#[utoipa::path(post, path = "/v1/gaia-x/wallet/vc-init", tag = "Gaia-X Wallet",
    responses(
        (status = 200, description = "Wallet verification session initiated"),
        (status = 503, description = "VC service unavailable"),
    )
)]
pub async fn init_wallet_session(
    State(state): State<AppState>,
    RequireOrgAdmin(_ctx): RequireOrgAdmin,
) -> Result<impl IntoResponse, AuthError> {
    let client = state.gaia_x.vc_client.as_ref()
        .ok_or(AuthError::VcUnavailable)?;

    let verifier_url = state.gaia_x.walt_id_verifier_url.as_deref()
        .ok_or(AuthError::VcUnavailable)?;

    let body = vc_client::create_verification_session(client, &verifier_url)
        .await
        .map_err(AuthError::Internal)?;

    Ok(data_response(json!({
        "session_id": body["id"],
        "qr_url": body["url"],
    })))
}

#[utoipa::path(get, path = "/v1/gaia-x/wallet/vc-status/{session_id}", tag = "Gaia-X Wallet",
    params(("session_id" = String, Path, description = "Verification session ID")),
    responses((status = 200, description = "Session status (pending | authenticated | expired)"))
)]
pub async fn wallet_verify_status(
    State(state): State<AppState>,
    RequireOrgAdmin(_ctx): RequireOrgAdmin,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> Result<impl IntoResponse, AuthError> {
    let client = state.gaia_x.vc_client.as_ref()
        .ok_or(AuthError::VcUnavailable)?;

    let verifier_url = state.gaia_x.walt_id_verifier_url.as_deref()
        .ok_or(AuthError::VcUnavailable)?;

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

#[utoipa::path(get, path = "/v1/gaia-x/wallet", tag = "Gaia-X Wallet",
    responses((status = 200, description = "Wallet connection status"))
)]
pub async fn get_wallet(
    State(state): State<AppState>,
    RequireOrgAdmin(_ctx): RequireOrgAdmin,
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

#[utoipa::path(post, path = "/v1/gaia-x/wallet/vc-connect", tag = "Gaia-X Wallet",
    request_body = ConnectPayload,
    responses(
        (status = 200, description = "Wallet connected"),
        (status = 400, description = "Verification not successful"),
    )
)]
pub async fn save_wallet_connection(
    State(state): State<AppState>,
    RequireOrgAdmin(_ctx): RequireOrgAdmin,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
    Json(payload): Json<ConnectPayload>,
) -> Result<impl IntoResponse, AuthError> {
    let client = state.gaia_x.vc_client.as_ref()
        .ok_or(AuthError::VcUnavailable)?;

    let verifier_url = state.gaia_x.walt_id_verifier_url.as_deref()
        .ok_or(AuthError::VcUnavailable)?;

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

#[utoipa::path(delete, path = "/v1/gaia-x/wallet", tag = "Gaia-X Wallet",
    responses((status = 200, description = "Wallet disconnected"))
)]
pub async fn disconnect_wallet(
    State(state): State<AppState>,
    RequireOrgAdmin(_ctx): RequireOrgAdmin,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    state.db.unlink_did_from_user(&auth_user.user_id)
        .await
        .map_err(|e| AuthError::Internal(format!("DB error: {e}")))?;

    Ok(data_response(json!({ "connected": false })))
}
