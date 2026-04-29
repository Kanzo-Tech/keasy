//! Promotor-only admin endpoints.
//!
//! All handlers require `RequirePromotor` -- non-promotor users receive 403.

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::Deserialize;

use crate::AppState;
use crate::org::models::Organization;
use crate::error::data_response;
use crate::middleware::session_auth::AuthenticatedUser;
use crate::error::AppError;
use crate::middleware::tenant::{IsPromotor, Require};

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
) -> Result<impl IntoResponse, AppError> {
    let orgs = state.orgs.repo.list_organizations().await;
    Ok(data_response(orgs))
}

// ---------------------------------------------------------------------------
// POST /v1/admin/organizations
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
) -> Result<impl IntoResponse, AppError> {
    let (org, _token) = state
        .orgs
        .create_org_and_invite(&payload.name, &auth_user.user_id)
        .await?;

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
// GET /v1/admin/invites
// ---------------------------------------------------------------------------

#[utoipa::path(get, path = "/v1/admin/invites", tag = "Admin",
    responses((status = 200, description = "List all invite tokens", body = Vec<AdminInviteEntry>))
)]
pub async fn list_invites(
    _ctx: Require<IsPromotor>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let (tokens, org_map) = state.orgs.list_admin_invites().await;
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
// POST /v1/admin/invites
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
) -> Result<impl IntoResponse, AppError> {
    let (org, token_value) = state
        .orgs
        .create_org_and_invite(&payload.org_name, &auth_user.user_id)
        .await?;

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
// DELETE /v1/admin/invites/{token}
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
) -> Result<impl IntoResponse, AppError> {
    state.orgs.admin_revoke_invite(&token).await?;
    Ok(StatusCode::NO_CONTENT)
}
