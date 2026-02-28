//! Org admin user management endpoints.
//! All handlers require `RequireOrgAdmin` — available to org admins and promotors.
//! These routes live inside `api_routes` (session + tenant context required).

use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::AppState;
use crate::db::invite_tokens::InviteToken;
use crate::error::{data_response, error_body};
use crate::middleware::session_auth::AuthenticatedUser;
use crate::middleware::tenant::{RbacError, RequireOrgAdmin, TenantContext};

/// GET /v1/org/users — list all users in the caller's org.
pub async fn list_users(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let users = state.db.list_users_in_org(&ctx.org_id.0).await;
    Ok(data_response(users))
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRoleRequest {
    pub role: String,
}

/// PUT /v1/org/users/{id} — change a user's role within the org.
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
        .update_user_role_in_org(&user_id, &ctx.org_id.0, &payload.role)
        .await
        .map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /v1/org/users/{id} — remove a user from the org.
pub async fn remove_user(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<impl IntoResponse, RbacError> {
    state
        .db
        .remove_user_from_org(&user_id, &ctx.org_id.0)
        .await
        .map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Organization identity ────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
struct OrgIdentityResponse {
    legal_name: String,
    country: String,
    registration_number: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOrgIdentityPayload {
    pub legal_name: String,
    pub country: String,
    pub registration_number: Option<String>,
}

/// GET /v1/org/identity — read the org's identity fields (any tenant user).
pub async fn get_org_identity(
    Extension(ctx): Extension<TenantContext>,
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

/// PUT /v1/org/identity — update org identity fields (org admins + promotors).
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

#[derive(Debug, Deserialize)]
pub struct CreateOrgInviteRequest {
    pub role: String,
}

/// POST /v1/org/invites — create an invite token scoped to the caller's org.
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
        email: None,
        org_id: ctx.org_id.0.clone(),
        role: payload.role.clone(),
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

    let invite_url = format!("{}/invite?token={}", state.base_url, token_value);
    Ok((
        StatusCode::CREATED,
        data_response(serde_json::json!({
            "token": token_value,
            "invite_url": invite_url,
        })),
    ))
}

/// GET /v1/org/invites — list invite tokens for the caller's org.
pub async fn list_org_invites(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let tokens = state.db.list_invite_tokens_for_org(&ctx.org_id.0).await;
    let now = jiff::Timestamp::now().to_string();
    let result: Vec<serde_json::Value> = tokens
        .into_iter()
        .map(|t| {
            let status = if t.used_at.is_some() {
                "used"
            } else if now > t.expires_at {
                "expired"
            } else {
                "pending"
            };
            serde_json::json!({
                "token": t.token,
                "role": t.role,
                "status": status,
                "created_at": t.created_at,
                "expires_at": t.expires_at,
                "used_at": t.used_at,
            })
        })
        .collect();
    Ok(data_response(result))
}

/// DELETE /v1/org/invites/{token} — revoke an invite token (must belong to caller's org).
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
