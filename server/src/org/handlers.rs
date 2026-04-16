//! Org management endpoints -- participant only.
//! User/invite management requires `RequireOrgAdmin` (participant org admins).
//! Identity read uses `RequireParticipant` (any participant user).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::LazyLock;
use regex::Regex;
use serde::Deserialize;

use crate::AppState;
use crate::org::models::OrgMember;
use crate::error::{data_response, error_body};
use crate::middleware::session_auth::AuthenticatedUser;
use crate::error::AppError;
use crate::middleware::tenant::{IsAdmin, IsParticipant, Require};

static SUBDIVISION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z]{2}-[A-Z0-9]{1,3}$").unwrap());

#[utoipa::path(get, path = "/v1/org/users", tag = "Organization",
    responses((status = 200, description = "List of users in the org", body = Vec<OrgMember>))
)]
pub async fn list_users(
    ctx: Require<IsAdmin>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let users = state.orgs.repo.list_org_members(&ctx.org_id.0).await;
    Ok(data_response(users))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateUserRoleRequest {
    pub role: String,
}

#[utoipa::path(put, path = "/v1/org/users/{id}", tag = "Organization",
    params(("id" = String, Path, description = "User ID")),
    request_body = UpdateUserRoleRequest,
    responses(
        (status = 204, description = "Role updated"),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn update_user_role(
    ctx: Require<IsAdmin>,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(payload): Json<UpdateUserRoleRequest>,
) -> Result<impl IntoResponse, AppError> {
    state.orgs.update_member_role(&user_id, &ctx.org_id.0, &payload.role).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/v1/org/users/{id}", tag = "Organization",
    params(("id" = String, Path, description = "User ID")),
    responses(
        (status = 204, description = "User removed"),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn remove_user(
    ctx: Require<IsAdmin>,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    state.orgs.remove_member(&user_id, &ctx.org_id.0).await?;
    Ok(StatusCode::NO_CONTENT)
}

// -- Organization identity ────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct OrgIdentityResponse {
    legal_name: String,
    country: String,
    registration_number: Option<String>,
    country_subdivision_code: Option<String>,
    registration_number_type: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateOrgIdentityPayload {
    pub legal_name: String,
    pub country: String,
    pub registration_number: Option<String>,
    pub country_subdivision_code: Option<String>,
    pub registration_number_type: Option<String>,
}

#[utoipa::path(get, path = "/v1/org/identity", tag = "Organization",
    responses(
        (status = 200, description = "Org identity", body = OrgIdentityResponse),
        (status = 404, description = "Organization not found"),
    )
)]
pub async fn get_org_identity(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let org = state.orgs.repo.get_organization(&ctx.org_id.0).await;
    match org {
        Some(o) => data_response(OrgIdentityResponse {
            legal_name: o.legal_name,
            country: o.country,
            registration_number: o.registration_number,
            country_subdivision_code: o.country_subdivision_code,
            registration_number_type: o.registration_number_type,
        })
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "Organization not found")),
        )
            .into_response(),
    }
}

#[utoipa::path(put, path = "/v1/org/identity", tag = "Organization",
    request_body = UpdateOrgIdentityPayload,
    responses(
        (status = 200, description = "Identity updated", body = OrgIdentityResponse),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn update_org_identity(
    ctx: Require<IsAdmin>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateOrgIdentityPayload>,
) -> Result<impl IntoResponse, AppError> {
    let legal_name = payload.legal_name.trim().to_string();
    if legal_name.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", "legal_name must not be empty")),
        )
            .into_response());
    }
    if payload.country.len() != 2 {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", "country must be a 2-letter code")),
        )
            .into_response());
    }

    if let Some(ref rnt) = payload.registration_number_type
        && !matches!(rnt.as_str(), "vatID" | "leiCode" | "EORI") {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(error_body("bad_request", "registration_number_type must be vatID, leiCode, or EORI")),
            )
                .into_response());
        }

    if let Some(ref csc) = payload.country_subdivision_code
        && !SUBDIVISION_RE.is_match(csc) {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(error_body("bad_request", "country_subdivision_code must match ISO 3166-2 (e.g. DE-BY)")),
            )
                .into_response());
        }

    state
        .orgs
        .update_org_identity(
            &ctx.org_id.0,
            &legal_name,
            &payload.country,
            payload.registration_number.as_deref(),
            payload.country_subdivision_code.as_deref(),
            payload.registration_number_type.as_deref(),
        )
        .await?;

    Ok(data_response(OrgIdentityResponse {
        legal_name,
        country: payload.country,
        registration_number: payload.registration_number,
        country_subdivision_code: payload.country_subdivision_code,
        registration_number_type: payload.registration_number_type,
    })
    .into_response())
}

// -- Org invite management ────────────────────────────────────────────────────

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct OrgInviteEntry {
    pub token: String,
    pub role: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateOrgInviteRequest {
    pub role: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct CreateOrgInviteResponse {
    pub token: String,
    pub invite_url: String,
}

#[utoipa::path(post, path = "/v1/org/invites", tag = "Organization",
    request_body = CreateOrgInviteRequest,
    responses(
        (status = 201, description = "Invite created", body = CreateOrgInviteResponse),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn create_org_invite(
    ctx: Require<IsAdmin>,
    axum::Extension(auth_user): axum::Extension<AuthenticatedUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrgInviteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let (token_value, _invite) = state
        .orgs
        .create_org_invite(&ctx.org_id.0, &payload.role, &auth_user.user_id)
        .await?;

    let invite_url = format!("{}/invite?token={}", state.base_url, token_value);
    Ok((
        StatusCode::CREATED,
        data_response(CreateOrgInviteResponse {
            token: token_value,
            invite_url,
        }),
    ))
}

#[utoipa::path(get, path = "/v1/org/invites", tag = "Organization",
    responses((status = 200, description = "List of org invite tokens", body = Vec<OrgInviteEntry>))
)]
pub async fn list_org_invites(
    ctx: Require<IsAdmin>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let tokens = state.orgs.repo.list_invite_tokens_for_org(&ctx.org_id.0).await;
    let now = jiff::Timestamp::now().to_string();
    let result: Vec<OrgInviteEntry> = tokens
        .into_iter()
        .map(|t| {
            let status = if now > t.expires_at { "expired" } else { "active" };
            OrgInviteEntry {
                token: t.token,
                role: t.role,
                status: status.to_string(),
                created_at: t.created_at,
                expires_at: t.expires_at,
            }
        })
        .collect();
    Ok(data_response(result))
}

#[utoipa::path(delete, path = "/v1/org/invites/{token}", tag = "Organization",
    params(("token" = String, Path, description = "Invite token to revoke")),
    responses(
        (status = 204, description = "Invite revoked"),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn revoke_org_invite(
    ctx: Require<IsAdmin>,
    Path(token): Path<String>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    state.orgs.revoke_org_invite(&token, &ctx.org_id.0).await?;
    Ok(StatusCode::NO_CONTENT)
}
