use axum::extract::State;
use axum::response::IntoResponse;
use serde::Deserialize;
use serde_json::json;
use tower_sessions::Session;

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::db::organizations::OrgRole;
use crate::error::data_response;

/// GET /v1/auth/me
///
/// Returns the authenticated user's profile, org, and effective role.
/// Protected by session_required but NOT tenant_context_required.
#[utoipa::path(get, path = "/v1/auth/me", tag = "Auth",
    responses(
        (status = 200, description = "Authenticated user profile"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn get_me(
    _session: Session,
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
) -> Result<impl IntoResponse, AuthError> {
    let user = state
        .db
        .get_user(&auth_user.user_id)
        .await
        .ok_or(AuthError::Forbidden)?;

    let membership = state.db.get_user_org_membership(&auth_user.user_id).await;
    let org = match &membership {
        Some(m) => state.db.get_organization(&m.org_id).await,
        None => None,
    };

    // Compute effective role
    let membership_role = membership.as_ref().map(|m| m.role.as_str());
    let effective_role = match (&org, &membership) {
        (Some(o), Some(_)) if o.role == "promotor" => "promotor",
        (_, Some(m)) => match m.role {
            OrgRole::Admin => "org_admin",
            OrgRole::User => "org_user",
        },
        _ => "none",
    };

    Ok(data_response(json!({
        "user_id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "membership_role": membership_role,
        "effective_role": effective_role,
        "vc_holder_did": user.vc_holder_did,
        "wallet_connected_at": user.wallet_connected_at,
        "org": org.map(|o| json!({
            "id": o.id,
            "name": o.name,
            "role": o.role,
            "vc_verified_at": o.vc_verified_at,
        })),
    })))
}

/// GET /v1/auth/invite-info?token=<token> — validate an invite token exists and is not expired.
///
/// Public endpoint (no session required) — used by the invite page to check
/// whether the token is valid before showing the accept UI.
#[derive(Deserialize)]
pub struct InviteInfoQuery {
    pub token: String,
}

#[utoipa::path(get, path = "/v1/auth/invite-info", tag = "Auth",
    params(("token" = String, Query, description = "Invite token")),
    responses((status = 200, description = "Invite token validity"))
)]
pub async fn get_invite_info(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<InviteInfoQuery>,
) -> impl IntoResponse {
    let now = jiff::Timestamp::now().to_string();
    let valid = state
        .db
        .get_invite_token(&params.token)
        .await
        .map(|t| t.expires_at > now)
        .unwrap_or(false);
    data_response(json!({ "valid": valid }))
}

/// GET /v1/auth/workspaces
///
/// Returns the list of dataspaces the authenticated user has access to,
/// resolved from the `dataspaces` session value to display info via
/// the oidc_clients table. Used by the sidebar instance switcher.
#[utoipa::path(get, path = "/v1/auth/workspaces", tag = "Auth",
    responses((status = 200, description = "List of accessible workspaces"))
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

    let mut workspaces = Vec::new();
    for client_id in &dataspaces {
        // Check local cache first
        if let Some(client) = state.db.get_oidc_client_by_client_id(client_id).await {
            workspaces.push(json!({
                "client_id": client.client_id,
                "name": client.name,
                "url": client.url,
            }));
            continue;
        }
        // Cache miss — resolve via Keycloak Admin API and cache locally
        if let Some(kc_admin) = &state.auth.keycloak_admin {
            if let Some(resolved) = kc_admin.resolve_client(client_id).await {
                let _ = state.db.ensure_oidc_client(client_id, &resolved.name, &resolved.url).await;
                workspaces.push(json!({
                    "client_id": client_id,
                    "name": resolved.name,
                    "url": resolved.url,
                }));
            }
        }
    }

    Ok(data_response(json!({
        "workspaces": workspaces,
        "current_client_id": current_client_id,
    })))
}

/// POST /v1/auth/logout
///
/// Destroys the session cookie and removes the user_sessions DB entry.
/// Returns 200 with `end_session_url` — the Keycloak end-session URL for full
/// single logout. The frontend redirects the browser to this URL to complete
/// the OIDC RP-Initiated Logout flow.
///
/// If OIDC is not configured, `end_session_url` is null and the caller only
/// needs to clear the local session (existing VC behavior is preserved).
#[utoipa::path(post, path = "/v1/auth/logout", tag = "Auth",
    responses((status = 200, description = "Logout successful, returns end_session_url"))
)]
pub async fn logout(
    session: Session,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AuthError> {
    // Get user_id to clean up user_sessions table
    if let Ok(Some(user_id)) = session.get::<String>("user_id").await {
        let _ = state.db.delete_user_session(&user_id).await;
    }

    // Read id_token BEFORE flushing the session (flush destroys all session data).
    let id_token: Option<String> = session.get("id_token").await.ok().flatten();

    // Flush session — destroys data and removes from store, clears cookie
    session
        .flush()
        .await
        .map_err(|e| AuthError::Internal(format!("session flush failed: {e}")))?;

    // Build Keycloak end-session URL for OIDC RP-Initiated Logout.
    // Format: {issuer}/protocol/openid-connect/logout?client_id={id}&id_token_hint={jwt}&post_logout_redirect_uri={url}
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

    Ok(data_response(json!({ "end_session_url": end_session_url })))
}
