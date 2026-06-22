use axum::extract::State;
use axum::response::IntoResponse;
use tower_sessions::Session;

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::error::data_response;

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MeOrg {
    pub name: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MeResponse {
    pub user_id: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub effective_role: String,
    pub org: Option<MeOrg>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct WorkspacesResponse {
    /// Slugs of every workspace the user belongs to, from the `workspaces` token
    /// claim (captured at login). The web builds each `<slug>.<domain>` link.
    pub workspaces: Vec<String>,
    /// This instance's slug — the "current" entry in the switcher.
    pub current: String,
}

/// GET /v1/auth/me
///
/// Returns the authenticated user's profile, org, and effective role.
/// Protected by session_required but NOT tenant_context_required.
#[utoipa::path(get, path = "/v1/auth/me", tag = "Auth",
    responses(
        (status = 200, description = "Authenticated user profile", body = MeResponse),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn get_me(
    session: Session,
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    // Profile comes from the session values set at OIDC login.
    let email = session
        .get::<String>("user_email")
        .await
        .map_err(|e| AuthError::Internal(format!("session get user_email: {e}")))?
        .unwrap_or_default();
    let first_name = session
        .get::<String>("user_first_name")
        .await
        .map_err(|e| AuthError::Internal(format!("session get user_first_name: {e}")))?
        .unwrap_or_default();
    let last_name = session
        .get::<String>("user_last_name")
        .await
        .map_err(|e| AuthError::Internal(format!("session get user_last_name: {e}")))?
        .unwrap_or_default();

    // Role comes from the Keycloak `keasy:role` claim, captured at login.
    let role = auth_user.role;

    // The workspace identity is shown only to actual members.
    let org = if role.is_some() {
        state
            .db
            .get_workspace_identity()
            .await
            .map(|i| MeOrg { name: i.name })
    } else {
        None
    };

    let effective_role = role.map(|r| r.as_str()).unwrap_or("none");

    Ok(data_response(MeResponse {
        user_id: auth_user.user_id.clone(),
        email,
        first_name,
        last_name,
        effective_role: effective_role.to_string(),
        org,
    }))
}

/// GET /v1/auth/workspaces
///
/// The workspaces the authenticated user belongs to, for the sidebar switcher.
/// Sourced from the `workspaces` token claim (captured at login) — no runtime
/// Keycloak call; membership is declared in Terraform.
#[utoipa::path(get, path = "/v1/auth/workspaces", tag = "Auth",
    responses((status = 200, description = "List of accessible workspaces", body = WorkspacesResponse))
)]
pub async fn list_workspaces(
    session: Session,
    State(state): State<AppState>,
    _auth_user: axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    let workspaces = session
        .get::<Vec<String>>("workspaces")
        .await
        .map_err(|e| AuthError::Internal(format!("session get workspaces: {e}")))?
        .unwrap_or_default();

    let current = state.workspace_slug.clone().unwrap_or_default();

    Ok(data_response(WorkspacesResponse { workspaces, current }))
}

/// POST /v1/auth/logout
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct LogoutResponse {
    pub end_session_url: Option<String>,
}

#[utoipa::path(post, path = "/v1/auth/logout", tag = "Auth",
    responses((status = 200, description = "Logout successful, returns end_session_url", body = LogoutResponse))
)]
pub async fn logout(
    session: Session,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AuthError> {
    if let Ok(Some(user_id)) = session.get::<String>("user_id").await {
        let _ = state.db.delete_user_session(&user_id).await;
    }

    let id_token: Option<String> = session.get("id_token").await.ok().flatten();

    session
        .flush()
        .await
        .map_err(|e| AuthError::Internal(format!("session flush failed: {e}")))?;

    let end_session_url = if let (Some(oidc), Some(client_id)) =
        (&state.auth.oidc_state, &state.auth.oidc_client_id)
    {
        let post_logout_uri = state.base_url.trim_end_matches('/').to_string();
        let encoded_redirect = urlencoding::encode(&post_logout_uri);
        let mut url = format!(
            "{}/protocol/openid-connect/logout?client_id={}&post_logout_redirect_uri={}",
            oidc.issuer_url, client_id, encoded_redirect
        );
        if let Some(token) = &id_token {
            url.push_str(&format!("&id_token_hint={}", urlencoding::encode(token)));
        }
        Some(url)
    } else {
        None
    };

    Ok(data_response(LogoutResponse { end_session_url }))
}
