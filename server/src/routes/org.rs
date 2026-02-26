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
use crate::auth::password;
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

/// POST /v1/org/users — create user with temporary password, assign to org.
///
/// Returns the created user's info and the temporary password (shown once).
/// The org admin must communicate the temp password out-of-band.
/// The user changes it via PUT /v1/auth/password.
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

    // 3. Generate temporary password (16 chars alphanumeric + prefix ensuring complexity)
    use rand::Rng;
    let temp_suffix: String = rand::rng()
        .sample_iter(&rand::distr::Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    // Prefix ensures complexity: uppercase (K), lowercase (x), digit (1), special chars omitted
    let temp_password = format!("Kx{temp_suffix}1a");

    // 4. Hash password
    let password_hash = password::hash_password(temp_password.clone())
        .await
        .map_err(|e| RbacError::Internal(format!("hash password: {e}")))?;

    // 5. Create user
    let user_id = uuid::Uuid::new_v4().to_string();
    let now = jiff::Timestamp::now().to_string();
    let user = User {
        id: user_id.clone(),
        email: payload.email.clone(),
        first_name: payload.first_name.clone(),
        last_name: payload.last_name.clone(),
        password_hash,
        status: UserStatus::Active,
        created_at: now.clone(),
        updated_at: now,
    };
    state.db.create_user(&user).await.map_err(RbacError::Internal)?;

    // 6. Create org membership
    let membership_id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .create_user_org_membership(&membership_id, &user_id, &ctx.org_id.0, &payload.role)
        .await
        .map_err(RbacError::Internal)?;

    // 7. Return user info + temp password (shown once)
    Ok((
        StatusCode::CREATED,
        data_response(serde_json::json!({
            "user_id": user_id,
            "email": payload.email,
            "temporary_password": temp_password,
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
