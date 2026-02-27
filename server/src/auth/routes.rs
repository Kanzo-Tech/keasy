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
pub async fn get_me(
    session: Session,
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

    // Read auth_method from session — "vc" if authenticated via OID4VP, "oidc" otherwise.
    // OIDC is the primary auth method; password auth has been removed (Phase 11, IDENT-07).
    let auth_method: String = session
        .get::<String>("auth_method")
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "oidc".to_string());

    // Read whether the walt.id Verifier sidecar is currently reachable
    let vc_available = state.vc_available.load(std::sync::atomic::Ordering::Relaxed);

    // Compute effective role
    let membership_role = membership.as_ref().map(|m| m.role.as_str());
    let effective_role = match (&org, &membership) {
        (Some(o), Some(_)) if o.role == "promotor" => "promotor",
        (_, Some(m)) => match m.role {
            OrgRole::Admin => "org_admin",
            OrgRole::User => "org_user",
        },
        _ => "org_user",
    };

    Ok(data_response(json!({
        "user_id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "membership_role": membership_role,
        "effective_role": effective_role,
        "auth_method": auth_method,
        "vc_available": vc_available,
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

/// GET /v1/auth/invite-info?token=<token> — return pre-filled email for a valid unused token.
///
/// Public endpoint (no session required) — used by the invite registration page to
/// pre-fill the email field.
#[derive(Deserialize)]
pub struct InviteInfoQuery {
    pub token: String,
}

pub async fn get_invite_info(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<InviteInfoQuery>,
) -> impl IntoResponse {
    let token = state.db.get_invite_token(&params.token).await;
    match token {
        Some(t) if t.used_at.is_none() => data_response(json!({ "email": t.email })),
        _ => data_response(json!({ "email": null })),
    }
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
pub async fn logout(
    session: Session,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AuthError> {
    // Get user_id to clean up user_sessions table
    if let Ok(Some(user_id)) = session.get::<String>("user_id").await {
        let _ = state.db.delete_user_session(&user_id).await;
    }

    // Flush session — destroys data and removes from store, clears cookie
    session
        .flush()
        .await
        .map_err(|e| AuthError::Internal(format!("session flush failed: {e}")))?;

    // Build Keycloak end-session URL for OIDC RP-Initiated Logout.
    // Format: {issuer}/protocol/openid-connect/logout?client_id={id}&post_logout_redirect_uri={url}
    let end_session_url = if let (Some(oidc), Some(client_id)) =
        (&state.oidc_state, &state.oidc_client_id)
    {
        let post_logout_uri = format!("{}/login", state.base_url.trim_end_matches('/'));
        let encoded_redirect = urlencoding::encode(&post_logout_uri);
        Some(format!(
            "{}/protocol/openid-connect/logout?client_id={}&post_logout_redirect_uri={}",
            oidc.issuer_url, client_id, encoded_redirect
        ))
    } else {
        None
    };

    Ok(data_response(json!({ "end_session_url": end_session_url })))
}
