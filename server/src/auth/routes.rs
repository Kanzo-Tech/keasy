use axum::extract::State;
use axum::response::IntoResponse;
use serde::Deserialize;
use tower_sessions::Session;

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::error::data_response;

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MeOrg {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct MeResponse {
    pub user_id: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub membership_role: Option<String>,
    pub effective_role: String,
    pub org: Option<MeOrg>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct Workspace {
    pub client_id: String,
    pub name: String,
    pub url: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct WorkspacesResponse {
    pub workspaces: Vec<Workspace>,
    pub current_client_id: String,
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
    let membership = state.repos.get_org_membership(&auth_user.user_id).await;

    // Profile: prefer cached org_members data; fall back to session values set at login.
    let (email, first_name, last_name) = match &membership {
        Some(m) => (m.email.clone(), m.first_name.clone(), m.last_name.clone()),
        None => (
            session
                .get::<String>("user_email")
                .await
                .map_err(|e| AuthError::Internal(format!("session get user_email: {e}")))?
                .unwrap_or_default(),
            session
                .get::<String>("user_first_name")
                .await
                .map_err(|e| AuthError::Internal(format!("session get user_first_name: {e}")))?
                .unwrap_or_default(),
            session
                .get::<String>("user_last_name")
                .await
                .map_err(|e| AuthError::Internal(format!("session get user_last_name: {e}")))?
                .unwrap_or_default(),
        ),
    };

    let org = match &membership {
        Some(m) => state.repos.get_organization(&m.org_id).await,
        None => None,
    };

    // Compute effective role
    let effective_role = match (&org, &membership) {
        (Some(o), _) if o.role == "promotor" => "promotor",
        (_, Some(m)) if m.role == "admin" => "org_admin",
        (_, Some(_)) => "org_user",
        _ => "none",
    };

    Ok(data_response(MeResponse {
        user_id: auth_user.user_id.clone(),
        email,
        first_name,
        last_name,
        membership_role: membership.as_ref().map(|m| m.role.clone()),
        effective_role: effective_role.to_string(),
        org: org.map(|o| MeOrg { id: o.id, name: o.name, role: o.role }),
    }))
}

/// GET /v1/auth/invite-info?token=<token> — validate an invite token exists and is not expired.
///
/// Public endpoint (no session required) — used by the invite page to check
/// whether the token is valid before showing the accept UI.
#[derive(Deserialize)]
pub struct InviteInfoQuery {
    pub token: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct InviteInfoResponse {
    pub valid: bool,
}

#[utoipa::path(get, path = "/v1/auth/invite-info", tag = "Auth",
    params(("token" = String, Query, description = "Invite token")),
    responses((status = 200, description = "Invite token validity", body = InviteInfoResponse))
)]
pub async fn get_invite_info(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<InviteInfoQuery>,
) -> impl IntoResponse {
    let now = jiff::Timestamp::now().to_string();
    let valid = state
        .repos
        .get_invite_token(&params.token)
        .await
        .map(|t| t.expires_at > now)
        .unwrap_or(false);
    data_response(InviteInfoResponse { valid })
}

/// GET /v1/auth/workspaces
///
/// Returns the list of dataspaces the authenticated user has access to,
/// resolved from the `dataspaces` session value to display info via
/// the dataspaces table. Used by the sidebar instance switcher.
#[utoipa::path(get, path = "/v1/auth/workspaces", tag = "Auth",
    responses((status = 200, description = "List of accessible workspaces", body = WorkspacesResponse))
)]
pub async fn list_workspaces(
    _session: Session,
    State(state): State<AppState>,
    auth_user: axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    // Read workspaces live from Keycloak (user_id = Keycloak sub).
    let dataspaces: Vec<String> = if let Some(kc_admin) = &state.auth.keycloak_admin {
        match kc_admin.get_user_workspaces(&auth_user.user_id).await {
            Ok(ds) => {
                tracing::debug!(user_id = %auth_user.user_id, workspaces = ?ds, "Keycloak workspaces");
                ds
            }
            Err(e) => {
                tracing::warn!(error = %e, user_id = %auth_user.user_id, "Failed to read workspaces from Keycloak");
                Vec::new()
            }
        }
    } else {
        tracing::debug!("No Keycloak admin configured, returning empty workspaces");
        Vec::new()
    };

    let current_client_id = state.auth.oidc_client_id.clone().unwrap_or_default();

    // Batch lookup: resolve all dataspaces in a single query
    let client_id_refs: Vec<&str> = dataspaces.iter().map(|s| s.as_str()).collect();
    let cached = state.repos.get_dataspaces_by_client_ids(&client_id_refs).await;
    let cached_ids: std::collections::HashSet<String> = cached.iter().map(|d| d.client_id.clone()).collect();

    let mut workspaces: Vec<Workspace> = cached
        .into_iter()
        .map(|ds| Workspace { client_id: ds.client_id, name: ds.name, url: ds.url })
        .collect();

    // Resolve cache misses individually via Keycloak Admin API
    for client_id in &dataspaces {
        if cached_ids.contains(client_id) {
            continue;
        }
        if let Some(kc_admin) = &state.auth.keycloak_admin
            && let Some(resolved) = kc_admin.resolve_client(client_id).await {
                let _ = state.repos.ensure_dataspace(client_id, &resolved.name, &resolved.url).await;
                workspaces.push(Workspace {
                    client_id: client_id.clone(),
                    name: resolved.name,
                    url: resolved.url,
                });
            }
    }

    Ok(data_response(WorkspacesResponse { workspaces, current_client_id }))
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
        let _ = state.repos.delete_user_session(&user_id).await;
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
