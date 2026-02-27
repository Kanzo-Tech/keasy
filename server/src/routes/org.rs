//! Org admin user management endpoints.
//! All handlers require `RequireOrgAdmin` — available to org admins and promotors.
//! These routes live inside `api_routes` (session + tenant context required).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::AppState;
use crate::db::users::{User, UserStatus};
use crate::error::data_response;
use crate::middleware::tenant::{RbacError, RequireOrgAdmin};

/// GET /v1/org/users — list all users in the caller's org.
pub async fn list_users(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let users = state.db.list_users_in_org(&ctx.org_id.0).await;
    Ok(data_response(users))
}

#[derive(Debug, Deserialize)]
pub struct AddUserRequest {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub role: String, // "admin" or "user"
}

/// POST /v1/org/users — create a placeholder user record and assign to org.
///
/// With OIDC auth, users authenticate via Keycloak. The user record is created
/// with an empty password_hash — the user will log in via OIDC (Keycloak will
/// provision their credentials). An invite token should be sent separately.
pub async fn add_user(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
    Json(payload): Json<AddUserRequest>,
) -> Result<impl IntoResponse, RbacError> {
    // 1. Validate role
    if payload.role != "admin" && payload.role != "user" {
        return Err(RbacError::Internal("role must be 'admin' or 'user'".to_string()));
    }

    // 2. Check if email already exists
    if state.db.get_user_by_email(&payload.email).await.is_some() {
        return Err(RbacError::Internal(format!(
            "user with email {} already exists",
            payload.email
        )));
    }

    // 3. Create user — OIDC users have no local password (empty password_hash)
    let user_id = uuid::Uuid::new_v4().to_string();
    let now = jiff::Timestamp::now().to_string();
    let user = User {
        id: user_id.clone(),
        email: payload.email.clone(),
        first_name: payload.first_name.clone(),
        last_name: payload.last_name.clone(),
        password_hash: String::new(), // OIDC users have no local password
        status: UserStatus::Active,
        created_at: now.clone(),
        updated_at: now,
    };
    state.db.create_user(&user).await.map_err(RbacError::Internal)?;

    // 4. Create org membership
    let membership_id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .create_user_org_membership(&membership_id, &user_id, &ctx.org_id.0, &payload.role)
        .await
        .map_err(RbacError::Internal)?;

    // 5. Return user info
    Ok((
        StatusCode::CREATED,
        data_response(serde_json::json!({
            "user_id": user_id,
            "email": payload.email,
        })),
    ))
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
