//! Promotor-only admin endpoints.
//!
//! All handlers require `RequirePromotor` — non-promotor users receive 403
//! `rbac/insufficient_role`. These routes live inside `api_routes` and are
//! therefore also protected by `session_required` and `tenant_context_required`.

use std::collections::HashMap;

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::Deserialize;

use crate::AppState;
use crate::db::invite_tokens::InviteToken;
use crate::db::dataspaces::Dataspace;
use crate::db::organizations::{Organization, generate_unique_slug};
use crate::error::data_response;
use crate::middleware::session_auth::AuthenticatedUser;
use crate::middleware::tenant::{IsPromotor, RbacError, Require};

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct CreateOrgResponse {
    pub id: String,
    pub name: String,
    pub status: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct RegisterDataspaceResponse {
    pub id: String,
    pub client_id: String,
    pub client_secret: String,
    pub name: String,
    pub url: String,
    pub description: Option<String>,
    pub logo: Option<String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AdminInviteEntry {
    pub token: String,
    pub org_id: String,
    pub org_name: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AdminInviteResult {
    pub token: String,
    pub org_id: String,
    pub org_name: String,
    pub invite_url: String,
}

// ---------------------------------------------------------------------------
// GET /v1/admin/organizations
// ---------------------------------------------------------------------------

#[utoipa::path(get, path = "/v1/admin/organizations", tag = "Admin",
    responses((status = 200, description = "List all organizations", body = Vec<Organization>))
)]
pub async fn list_all_orgs(
    _ctx: Require<IsPromotor>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let orgs = state.db.list_organizations().await;
    Ok(data_response(orgs))
}

// ---------------------------------------------------------------------------
// POST /v1/admin/organizations — create org + invite token + send email
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateOrgAndInviteRequest {
    pub name: String,
}

#[utoipa::path(post, path = "/v1/admin/organizations", tag = "Admin",
    request_body = CreateOrgAndInviteRequest,
    responses(
        (status = 201, description = "Organization created with invite", body = CreateOrgResponse),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn create_org_and_invite(
    _ctx: Require<IsPromotor>,
    axum::Extension(auth_user): axum::Extension<AuthenticatedUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrgAndInviteRequest>,
) -> Result<impl IntoResponse, RbacError> {
    let now = jiff::Timestamp::now().to_string();

    // 1. Create organization as participant
    let slug = {
        let (_permit, conn) = state.db.read().await;
        generate_unique_slug(&conn, &payload.name)
    };
    let org = Organization {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.name.clone(),
        slug,
        legal_name: payload.name.clone(),
        registration_number: None,
        country_subdivision_code: None,
        registration_number_type: None,
        country: "EU".to_string(),
        role: "participant".to_string(),
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
        org_id: org.id.clone(),
        role: "admin".to_string(),
        created_by: auth_user.user_id.clone(),
        expires_at,
        created_at: now,
    };
    state
        .db
        .create_invite_token(&invite)
        .await
        .map_err(RbacError::Internal)?;

    // 3. Return created org
    Ok((
        StatusCode::CREATED,
        data_response(CreateOrgResponse {
            id: org.id,
            name: org.name,
            status: "pending".to_string(),
        }),
    ))
}

// ---------------------------------------------------------------------------
// POST /v1/admin/oidc-clients — Register a dataspace instance as an OIDC client
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct RegisterOidcClientRequest {
    pub name: String,
    pub url: String,
    pub description: Option<String>,
    pub logo: Option<String>,
}

#[utoipa::path(post, path = "/v1/admin/oidc-clients", tag = "Admin",
    request_body = RegisterOidcClientRequest,
    responses(
        (status = 201, description = "OIDC client registered", body = RegisterDataspaceResponse),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn register_dataspace(
    _ctx: Require<IsPromotor>,
    State(state): State<AppState>,
    Json(payload): Json<RegisterOidcClientRequest>,
) -> Result<impl IntoResponse, RbacError> {
    // 1. Verify Keycloak admin is configured
    let kc_admin = state.auth.keycloak_admin.as_ref().ok_or_else(|| {
        RbacError::Internal(
            "Identity service not configured — set KEASY_OIDC_* environment variables".to_string(),
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
    let dataspace = Dataspace {
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
        .create_dataspace(&dataspace)
        .await
        .map_err(RbacError::Internal)?;

    // 5. Return the record WITH client_secret (one-time display — not stored)
    Ok((
        StatusCode::CREATED,
        data_response(RegisterDataspaceResponse {
            id,
            client_id,
            client_secret: registered.client_secret,
            name: payload.name,
            url: payload.url,
            description: payload.description,
            logo: payload.logo,
        }),
    ))
}

// ---------------------------------------------------------------------------
// GET /v1/admin/oidc-clients — List all registered dataspace instances
// ---------------------------------------------------------------------------

#[utoipa::path(get, path = "/v1/admin/oidc-clients", tag = "Admin",
    responses((status = 200, description = "List of registered OIDC clients", body = Vec<Dataspace>))
)]
pub async fn list_dataspaces(
    _ctx: Require<IsPromotor>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let clients = state.db.list_dataspaces().await;
    Ok(data_response(clients))
}

// ---------------------------------------------------------------------------
// GET /v1/admin/invites — List all invite tokens
// ---------------------------------------------------------------------------

#[utoipa::path(get, path = "/v1/admin/invites", tag = "Admin",
    responses((status = 200, description = "List all invite tokens", body = Vec<AdminInviteEntry>))
)]
pub async fn list_invites(
    _ctx: Require<IsPromotor>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let tokens = state.db.list_invite_tokens().await;
    let orgs = state.db.list_organizations().await;
    let org_map: HashMap<String, String> = orgs
        .into_iter()
        .map(|o| (o.id.clone(), o.name.clone()))
        .collect();
    let now = jiff::Timestamp::now().to_string();
    let result: Vec<AdminInviteEntry> = tokens
        .into_iter()
        .map(|t| {
            let status = if now > t.expires_at { "expired" } else { "active" };
            AdminInviteEntry {
                org_name: org_map.get(&t.org_id).cloned().unwrap_or_default(),
                token: t.token,
                org_id: t.org_id,
                status: status.to_string(),
                created_at: t.created_at,
                expires_at: t.expires_at,
            }
        })
        .collect();
    Ok(data_response(result))
}

// ---------------------------------------------------------------------------
// POST /v1/admin/invites — Create invite link (no email sent)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateInviteRequest {
    pub org_name: String,
}

#[utoipa::path(post, path = "/v1/admin/invites", tag = "Admin",
    request_body = CreateInviteRequest,
    responses(
        (status = 201, description = "Invite created", body = AdminInviteResult),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn create_invite(
    _ctx: Require<IsPromotor>,
    axum::Extension(auth_user): axum::Extension<AuthenticatedUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateInviteRequest>,
) -> Result<impl IntoResponse, RbacError> {
    let now = jiff::Timestamp::now().to_string();

    // 1. Create participant org
    let slug = {
        let (_permit, conn) = state.db.read().await;
        generate_unique_slug(&conn, &payload.org_name)
    };
    let org = Organization {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.org_name.clone(),
        slug,
        legal_name: payload.org_name.clone(),
        registration_number: None,
        country_subdivision_code: None,
        registration_number_type: None,
        country: "EU".to_string(),
        role: "participant".to_string(),
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
        org_id: org.id.clone(),
        role: "admin".to_string(),
        created_by: auth_user.user_id.clone(),
        expires_at,
        created_at: now,
    };
    state
        .db
        .create_invite_token(&invite)
        .await
        .map_err(RbacError::Internal)?;

    // 3. Build invite URL
    let invite_url = format!("{}/invite?token={}", state.base_url, token_value);
    Ok((
        StatusCode::CREATED,
        data_response(AdminInviteResult {
            token: token_value,
            org_id: org.id,
            org_name: org.name,
            invite_url,
        }),
    ))
}

// ---------------------------------------------------------------------------
// DELETE /v1/admin/invites/{token} — Revoke an invite token
// ---------------------------------------------------------------------------

#[utoipa::path(delete, path = "/v1/admin/invites/{token}", tag = "Admin",
    params(("token" = String, Path, description = "Invite token to revoke")),
    responses(
        (status = 204, description = "Invite revoked"),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn revoke_invite(
    _ctx: Require<IsPromotor>,
    axum::extract::Path(token): axum::extract::Path<String>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    state
        .db
        .delete_invite_token(&token)
        .await
        .map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}
