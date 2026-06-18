//! Self-service onboarding (central mode only).
//!
//! A logged-in user with no workspace provisions their own by calling the
//! control-plane server-to-server (internal overlay, keyed with `CP_API_KEY`).
//! First-user-becomes-owner: the control-plane makes the verified caller the
//! owner. The web redirects to the returned workspace URL.

use axum::extract::{Query, State};
use axum::response::IntoResponse;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::error::data_response;
use crate::middleware::session_auth::AuthenticatedUser;

#[derive(Deserialize, utoipa::ToSchema)]
pub struct OnboardRequest {
    /// Display label for the workspace.
    pub name: String,
    /// Desired handle (subdomain); validated + slugified by the control-plane.
    pub handle: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct OnboardResponse {
    /// The new (or already-owned) workspace's home URL — the client redirects here.
    pub url: String,
}

#[derive(Deserialize)]
pub struct HandleCheckQuery {
    pub handle: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct HandleCheckResponse {
    pub available: bool,
    /// The normalized (slugified) handle.
    pub handle: String,
}

/// POST /v1/onboard — provision the caller's workspace and make them owner.
///
/// Idempotent: a user who already owns a workspace gets its URL back rather than a
/// second one. Session required (central mode only).
#[utoipa::path(post, path = "/v1/onboard", tag = "Auth",
    request_body = OnboardRequest,
    responses(
        (status = 200, description = "Workspace ready", body = OnboardResponse),
        (status = 400, description = "Invalid or taken handle"),
    )
)]
pub async fn onboard(
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<AuthenticatedUser>,
    axum::Json(req): axum::Json<OnboardRequest>,
) -> Result<impl IntoResponse, AuthError> {
    let cp = cp_url(&state)?;
    let key = state
        .auth
        .control_plane_key
        .as_ref()
        .ok_or_else(|| AuthError::Internal("control-plane key not configured".into()))?;
    let http = reqwest::Client::new();
    let subject = &auth_user.user_id;

    // Idempotency: return the existing workspace if the user already owns one (also
    // catches a half-finished retry — the registry row is written last, atomically).
    if let Ok(resp) = http
        .get(format!("{cp}/workspaces/by-owner"))
        .query(&[("sub", subject.as_str())])
        .send()
        .await
        && resp.status().is_success()
    {
        let owned: Vec<serde_json::Value> = resp.json().await.unwrap_or_default();
        if let Some(url) = owned.first().and_then(|w| w.get("url")).and_then(|u| u.as_str()) {
            return Ok(data_response(OnboardResponse { url: url.to_string() }));
        }
    }

    // Create. The control-plane makes `subject` the owner of the new workspace.
    let resp = http
        .post(format!("{cp}/workspaces"))
        .bearer_auth(key.expose_secret())
        .json(&serde_json::json!({
            "name": req.name,
            "handle": req.handle,
            "owner_keycloak_sub": subject,
        }))
        .send()
        .await
        .map_err(|e| AuthError::Internal(format!("control-plane create: {e}")))?;

    let status = resp.status();
    if status == reqwest::StatusCode::BAD_REQUEST {
        return Err(AuthError::ValidationFailed("handle is invalid or already taken".into()));
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AuthError::Internal(format!(
            "control-plane create returned {status}: {body}"
        )));
    }
    let info: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AuthError::Internal(format!("parse control-plane response: {e}")))?;
    let url = info
        .get("url")
        .and_then(|u| u.as_str())
        .unwrap_or_default()
        .to_string();
    Ok(data_response(OnboardResponse { url }))
}

/// GET /v1/onboard/check?handle=… — handle availability (proxies the control-plane
/// so the browser never touches the internal-only control-plane). Session required.
#[utoipa::path(get, path = "/v1/onboard/check", tag = "Auth",
    params(("handle" = String, Query, description = "Desired handle")),
    responses((status = 200, description = "Handle availability", body = HandleCheckResponse))
)]
pub async fn check_handle(
    State(state): State<AppState>,
    Query(q): Query<HandleCheckQuery>,
) -> Result<impl IntoResponse, AuthError> {
    let cp = cp_url(&state)?;
    let http = reqwest::Client::new();
    let resp = http
        .get(format!("{cp}/workspaces/by-handle"))
        .query(&[("h", q.handle.as_str())])
        .send()
        .await
        .map_err(|e| AuthError::Internal(format!("control-plane by-handle: {e}")))?;
    if !resp.status().is_success() {
        return Err(AuthError::Internal(format!(
            "control-plane by-handle: {}",
            resp.status()
        )));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AuthError::Internal(format!("parse by-handle response: {e}")))?;
    Ok(data_response(HandleCheckResponse {
        available: v.get("available").and_then(|b| b.as_bool()).unwrap_or(false),
        handle: v.get("handle").and_then(|h| h.as_str()).unwrap_or_default().to_string(),
    }))
}

/// The control-plane base URL, or an error when central mode isn't configured.
fn cp_url(state: &AppState) -> Result<&str, AuthError> {
    state
        .auth
        .control_plane_url
        .as_deref()
        .ok_or_else(|| AuthError::Internal("control-plane URL not configured".into()))
}
