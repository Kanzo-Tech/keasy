//! Org management endpoints — participant only.
//! User/invite management requires `RequireOrgAdmin` (participant org admins).
//! Identity read uses `RequireParticipant` (any participant user).
//! These routes live inside `api_routes` (session + tenant context required).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::AppState;
use crate::db::invite_tokens::InviteToken;
use crate::db::org_members::OrgMember;
use crate::error::{data_response, error_body};
use crate::middleware::session_auth::AuthenticatedUser;
use crate::middleware::tenant::{RbacError, RequireOrgAdmin, RequireParticipant};

#[utoipa::path(get, path = "/v1/org/users", tag = "Organization",
    responses((status = 200, description = "List of users in the org", body = Vec<OrgMember>))
)]
pub async fn list_users(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let users = state.db.list_org_members(&ctx.org_id.0).await;
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
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(payload): Json<UpdateUserRoleRequest>,
) -> Result<impl IntoResponse, RbacError> {
    if payload.role != "admin" && payload.role != "user" {
        return Err(RbacError::Internal("role must be 'admin' or 'user'".to_string()));
    }
    state
        .db
        .update_member_role(&user_id, &ctx.org_id.0, &payload.role)
        .await
        .map_err(RbacError::Internal)?;
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
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<impl IntoResponse, RbacError> {
    state
        .db
        .remove_org_member(&user_id, &ctx.org_id.0)
        .await
        .map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Organization identity ────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
struct OrgIdentityResponse {
    legal_name: String,
    country: String,
    registration_number: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateOrgIdentityPayload {
    pub legal_name: String,
    pub country: String,
    pub registration_number: Option<String>,
}

#[utoipa::path(get, path = "/v1/org/identity", tag = "Organization",
    responses(
        (status = 200, description = "Org identity", body = OrgIdentityResponse),
        (status = 404, description = "Organization not found"),
    )
)]
pub async fn get_org_identity(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let org = state.db.get_organization(&ctx.org_id.0).await;
    match org {
        Some(o) => data_response(OrgIdentityResponse {
            legal_name: o.legal_name,
            country: o.country,
            registration_number: o.registration_number,
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
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
    Json(payload): Json<UpdateOrgIdentityPayload>,
) -> Result<impl IntoResponse, RbacError> {
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

    state
        .db
        .update_org_identity(
            &ctx.org_id.0,
            &legal_name,
            &payload.country,
            payload.registration_number.as_deref(),
        )
        .await
        .map_err(|e| RbacError::Internal(format!("failed to update org identity: {e}")))?;

    // Return the updated identity
    Ok(data_response(OrgIdentityResponse {
        legal_name,
        country: payload.country,
        registration_number: payload.registration_number,
    })
    .into_response())
}

// ── Org invite management ────────────────────────────────────────────────────

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

#[utoipa::path(post, path = "/v1/org/invites", tag = "Organization",
    request_body = CreateOrgInviteRequest,
    responses(
        (status = 201, description = "Invite created"),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn create_org_invite(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    axum::Extension(auth_user): axum::Extension<AuthenticatedUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrgInviteRequest>,
) -> Result<impl IntoResponse, RbacError> {
    if payload.role != "admin" && payload.role != "user" {
        return Err(RbacError::Internal("role must be 'admin' or 'user'".to_string()));
    }

    let now = jiff::Timestamp::now().to_string();
    let token_value = uuid::Uuid::new_v4().to_string();
    let expires_at = {
        let ts = jiff::Timestamp::now();
        ts.checked_add(jiff::SignedDuration::from_hours(7 * 24))
            .unwrap_or(ts)
            .to_string()
    };

    let invite = InviteToken {
        token: token_value.clone(),
        org_id: ctx.org_id.0.clone(),
        role: payload.role.clone(),
        created_by: auth_user.user_id.clone(),
        expires_at,
        created_at: now,
    };
    state
        .db
        .create_invite_token(&invite)
        .await
        .map_err(RbacError::Internal)?;

    let invite_url = format!("{}/invite?token={}", state.base_url, token_value);
    Ok((
        StatusCode::CREATED,
        data_response(serde_json::json!({
            "token": token_value,
            "invite_url": invite_url,
        })),
    ))
}

#[utoipa::path(get, path = "/v1/org/invites", tag = "Organization",
    responses((status = 200, description = "List of org invite tokens", body = Vec<OrgInviteEntry>))
)]
pub async fn list_org_invites(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let tokens = state.db.list_invite_tokens_for_org(&ctx.org_id.0).await;
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
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    Path(token): Path<String>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    // Security: verify token belongs to this org before deleting
    let invite = state.db.get_invite_token(&token).await.ok_or_else(|| {
        RbacError::Internal("invite token not found".to_string())
    })?;
    if invite.org_id != ctx.org_id.0 {
        return Err(RbacError::Internal("invite token not found".to_string()));
    }
    state
        .db
        .delete_invite_token(&token)
        .await
        .map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}
