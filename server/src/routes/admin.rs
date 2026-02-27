//! Promotor-only admin endpoints.
//!
//! All handlers require `RequirePromotor` — non-promotor users receive 403
//! `rbac/insufficient_role`. These routes live inside `api_routes` and are
//! therefore also protected by `session_required` and `tenant_context_required`.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;

use crate::AppState;
use crate::db::invite_tokens::InviteToken;
use crate::db::oidc_clients::OidcClient;
use crate::db::organizations::Organization;
use crate::error::data_response;
use crate::middleware::session_auth::AuthenticatedUser;
use crate::middleware::tenant::{RequirePromotor, RbacError};

// ---------------------------------------------------------------------------
// GET /v1/admin/organizations
// ---------------------------------------------------------------------------

pub async fn list_all_orgs(
    RequirePromotor(_ctx): RequirePromotor,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let orgs = state.db.list_organizations().await;
    Ok(data_response(orgs))
}

// ---------------------------------------------------------------------------
// POST /v1/admin/organizations — create org + invite token + send email
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateOrgAndInviteRequest {
    pub name: String,
    pub admin_email: String,
}

/// POST /v1/admin/organizations — create org, generate invite token, send invite email.
pub async fn create_org_and_invite(
    RequirePromotor(_ctx): RequirePromotor,
    axum::Extension(auth_user): axum::Extension<AuthenticatedUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrgAndInviteRequest>,
) -> Result<impl IntoResponse, RbacError> {
    let now = jiff::Timestamp::now().to_string();

    // 1. Create organization as participant
    let org = Organization {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.name.clone(),
        legal_name: payload.name.clone(),
        registration_number: None,
        country: "EU".to_string(),
        role: "participant".to_string(),
        vc_verified_at: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    state
        .db
        .create_organization(&org)
        .await
        .map_err(RbacError::Internal)?;

    // 2. Create invite token (7-day expiry)
    let token_value = uuid::Uuid::new_v4().to_string();
    let expires_at = {
        let ts = jiff::Timestamp::now();
        ts.checked_add(jiff::SignedDuration::from_hours(7 * 24))
            .unwrap_or(ts)
            .to_string()
    };
    let invite = InviteToken {
        token: token_value.clone(),
        email: Some(payload.admin_email.clone()),
        org_id: org.id.clone(),
        role: "admin".to_string(),
        created_by: auth_user.user_id.clone(),
        used_at: None,
        expires_at,
        created_at: now,
    };
    state
        .db
        .create_invite_token(&invite)
        .await
        .map_err(RbacError::Internal)?;

    // 3. Send invite email — fire-and-forget via tokio::spawn to not block response
    let email_service = state.email_service.clone();
    let to = payload.admin_email.clone();
    let base_url = state.base_url.clone();
    let org_name = payload.name.clone();
    tokio::spawn(async move {
        if let Err(e) = email_service
            .send_invite_email(&to, &token_value, &base_url, &org_name)
            .await
        {
            tracing::error!(to = %to, error = %e, "failed to send invite email");
        }
    });

    // 4. Return created org
    Ok((
        StatusCode::CREATED,
        data_response(serde_json::json!({
            "id": org.id,
            "name": org.name,
            "status": "pending",
        })),
    ))
}

// ---------------------------------------------------------------------------
// POST /v1/admin/oidc-clients — Register a dataspace instance as an OIDC client
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RegisterOidcClientRequest {
    pub name: String,
    pub url: String,
    pub description: Option<String>,
    pub logo: Option<String>,
}

/// POST /v1/admin/oidc-clients — Register a new dataspace instance as an OIDC client.
///
/// Creates the OIDC client in Keycloak, stores display metadata in SQLite,
/// and returns the registered instance record including client_id and client_secret.
/// The client_secret is returned once and NOT stored — the caller must save it.
pub async fn register_oidc_client(
    RequirePromotor(_ctx): RequirePromotor,
    State(state): State<AppState>,
    Json(payload): Json<RegisterOidcClientRequest>,
) -> Result<impl IntoResponse, RbacError> {
    // 1. Verify Keycloak admin is configured
    let kc_admin = state.keycloak_admin.as_ref().ok_or_else(|| {
        RbacError::Internal(
            "Identity service not configured — set KEASY_OIDC_* environment variables"
                .to_string(),
        )
    })?;

    let now = jiff::Timestamp::now().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let client_id = format!("keasy-instance-{}", uuid::Uuid::new_v4());

    // 2. Build redirect URI and web origin from the instance URL
    let redirect_uri = format!(
        "{}/v1/auth/oidc-callback",
        payload.url.trim_end_matches('/')
    );
    let web_origin = payload.url.trim_end_matches('/').to_string();

    // 3. Create OIDC client in Keycloak
    let registered = kc_admin
        .create_client(
            &client_id,
            &payload.name,
            payload.description.as_deref(),
            &redirect_uri,
            &web_origin,
        )
        .await
        .map_err(RbacError::Internal)?;

    // 4. Store display metadata in SQLite (NO secret stored)
    let oidc_client = OidcClient {
        id: id.clone(),
        client_id: client_id.clone(),
        name: payload.name.clone(),
        url: payload.url.clone(),
        description: payload.description.clone(),
        logo: payload.logo.clone(),
        created_at: now.clone(),
        updated_at: now,
    };
    state
        .db
        .create_oidc_client(&oidc_client)
        .await
        .map_err(RbacError::Internal)?;

    // 5. Return the record WITH client_secret (one-time display — not stored)
    Ok((
        StatusCode::CREATED,
        data_response(serde_json::json!({
            "id": id,
            "client_id": client_id,
            "client_secret": registered.client_secret,
            "name": payload.name,
            "url": payload.url,
            "description": payload.description,
            "logo": payload.logo,
        })),
    ))
}

// ---------------------------------------------------------------------------
// GET /v1/admin/oidc-clients — List all registered dataspace instances
// ---------------------------------------------------------------------------

/// GET /v1/admin/oidc-clients — List all registered dataspace instances.
///
/// Returns display metadata only — no secrets.
pub async fn list_oidc_clients(
    RequirePromotor(_ctx): RequirePromotor,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let clients = state.db.list_oidc_clients().await;
    Ok(data_response(clients))
}
