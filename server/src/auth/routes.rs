use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use time::OffsetDateTime;
use tower_sessions::{Expiry, Session};

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::auth::models::{LoginRequest, RegisterRequest};
use crate::auth::password;
use crate::db::dataspaces::{DataspaceRole, OrgRole};
use crate::db::users::{User, UserStatus};
use crate::error::data_response;

/// POST /v1/auth/set-dataspace request body
#[derive(serde::Deserialize)]
pub struct SetDataspaceRequest {
    pub dataspace_id: String,
}

/// POST /v1/auth/register
///
/// Invite-only registration flow:
/// 1. Rate limit check
/// 2. Validate invite token (exists, unused, not expired)
/// 3. Validate email format and password complexity
/// 4. Hash password (Argon2id)
/// 5. Create user and org membership, mark token used
/// 6. Create session (24h fixed expiry, single-session enforced via user_sessions)
/// 7. Return 201 with user_id
pub async fn register(
    session: Session,
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<RegisterRequest>,
) -> Result<impl IntoResponse, AuthError> {
    // 1. Rate limit
    if !state.rate_limiter.check(addr.ip()) {
        return Err(AuthError::RateLimited);
    }

    // 2. Validate invite token
    let invite_token = state
        .db
        .get_invite_token(&payload.invite_token)
        .await
        .ok_or(AuthError::RegistrationFailed)?;

    // Token must not be used
    if invite_token.used_at.is_some() {
        return Err(AuthError::RegistrationFailed);
    }

    // Token must not be expired (expires_at is stored as a string — compare lexicographically)
    let now_str = jiff::Timestamp::now().to_string();
    if invite_token.expires_at <= now_str {
        return Err(AuthError::RegistrationFailed);
    }

    // 3. Validate email and password
    if !password::validate_email(&payload.email) {
        return Err(AuthError::RegistrationFailed);
    }
    if password::validate_password(&payload.password).is_err() {
        return Err(AuthError::RegistrationFailed);
    }

    // 4. Hash password
    let password_hash = password::hash_password(payload.password.clone()).await?;

    // 5a. Create user
    let user_id = uuid::Uuid::new_v4().to_string();
    let now_ts = jiff::Timestamp::now().to_string();
    let user = User {
        id: user_id.clone(),
        email: payload.email.clone(),
        first_name: String::new(),
        last_name: String::new(),
        password_hash,
        status: UserStatus::Active,
        created_at: now_ts.clone(),
        updated_at: now_ts.clone(),
    };

    state
        .db
        .create_user(&user)
        .await
        .map_err(|e| AuthError::Internal(format!("create_user failed: {e}")))?;

    // 5b. Create org membership
    let membership_id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .create_user_org_membership(&membership_id, &user_id, &invite_token.org_id, &invite_token.role)
        .await
        .map_err(|e| AuthError::Internal(format!("create_user_org_membership failed: {e}")))?;

    // 5c. Mark invite token used
    state
        .db
        .mark_invite_token_used(&payload.invite_token)
        .await
        .map_err(|e| AuthError::Internal(format!("mark_invite_token_used failed: {e}")))?;

    // 6. Set up session — cycle_id first to prevent session fixation
    session
        .cycle_id()
        .await
        .map_err(|e| AuthError::Internal(format!("cycle_id failed: {e}")))?;

    session
        .insert("user_id", &user_id)
        .await
        .map_err(|e| AuthError::Internal(format!("session insert failed: {e}")))?;

    session.set_expiry(Some(Expiry::AtDateTime(
        OffsetDateTime::now_utc() + time::Duration::hours(24),
    )));

    // Save the session to the store now so cycle_id assigns a new session ID.
    // cycle_id() sets session_id to None; save() calls store.create() which assigns a real ID.
    session
        .save()
        .await
        .map_err(|e| AuthError::Internal(format!("session save failed: {e}")))?;

    // Store in user_sessions for single-session enforcement
    let session_id = session
        .id()
        .ok_or_else(|| AuthError::Internal("session has no ID after save".to_string()))?
        .to_string();

    state
        .db
        .upsert_user_session(&user_id, &session_id)
        .await
        .map_err(|e| AuthError::Internal(format!("upsert_user_session failed: {e}")))?;

    // 7. Return 201
    Ok((
        StatusCode::CREATED,
        data_response(json!({ "user_id": user_id })),
    ))
}

/// POST /v1/auth/login
///
/// Timing-attack-safe login flow:
/// 1. Rate limit check
/// 2. Look up user by email
/// 3. ALWAYS verify password (dummy_hash if user not found)
/// 4. Check user status
/// 5. Cycle session ID (prevent session fixation)
/// 6. Insert user_id into session, set 24h expiry
/// 7. Enforce single session via user_sessions table
/// 8. Return 200 with user_id
pub async fn login(
    session: Session,
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, AuthError> {
    // 1. Rate limit
    if !state.rate_limiter.check(addr.ip()) {
        return Err(AuthError::RateLimited);
    }

    // 2. Look up user
    let user_opt = state.db.get_user_by_email(&payload.email).await;

    // 3. ALWAYS verify password — timing attack prevention
    let verified = match &user_opt {
        Some(user) => {
            password::verify_password(payload.password.clone(), user.password_hash.clone()).await
        }
        None => {
            // Run against dummy hash — same time, always false
            password::verify_password(
                payload.password.clone(),
                password::dummy_hash().to_string(),
            )
            .await
        }
    };

    // 4. Reject if user not found or password mismatch
    let user = match (user_opt, verified) {
        (Some(user), true) => user,
        _ => return Err(AuthError::InvalidCredentials),
    };

    // Check user status — same error code to avoid revealing account state
    if user.status != UserStatus::Active {
        return Err(AuthError::InvalidCredentials);
    }

    // 5. Cycle session ID before storing anything (session fixation prevention)
    session
        .cycle_id()
        .await
        .map_err(|e| AuthError::Internal(format!("cycle_id failed: {e}")))?;

    // 6. Store user_id and set 24h fixed expiry
    session
        .insert("user_id", user.id.clone())
        .await
        .map_err(|e| AuthError::Internal(format!("session insert failed: {e}")))?;

    session.set_expiry(Some(Expiry::AtDateTime(
        OffsetDateTime::now_utc() + time::Duration::hours(24),
    )));

    // Save the session to the store now so cycle_id assigns a new session ID.
    // cycle_id() sets session_id to None; save() calls store.create() which assigns a real ID.
    session
        .save()
        .await
        .map_err(|e| AuthError::Internal(format!("session save failed: {e}")))?;

    // 7. Enforce single session — AFTER cycle_id and save so we store the new session_id.
    // The old session_id in user_sessions is atomically replaced. The old session
    // data remains in the tower-sessions store until it expires naturally (24h),
    // but session_required middleware will reject it immediately since its session_id
    // no longer matches the active entry in user_sessions.
    let session_id = session
        .id()
        .ok_or_else(|| AuthError::Internal("session has no ID after save".to_string()))?
        .to_string();

    state
        .db
        .upsert_user_session(&user.id, &session_id)
        .await
        .map_err(|e| AuthError::Internal(format!("upsert_user_session failed: {e}")))?;

    // 8. Return 200 with user_id
    Ok(data_response(json!({ "user_id": user.id })))
}

/// POST /v1/auth/set-dataspace
///
/// Sets the active dataspace for the current session. Called after login
/// before any resource access. Validates that the user's org is a member
/// of the requested dataspace.
///
/// Protected by session_required but NOT tenant_context_required
/// (chicken-and-egg: you need to set a dataspace before tenant context can resolve).
pub async fn set_active_dataspace(
    session: Session,
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
    Json(payload): Json<SetDataspaceRequest>,
) -> Result<impl IntoResponse, AuthError> {
    // 1. Get user's org membership
    let membership = state
        .db
        .get_user_org_membership(&auth_user.user_id)
        .await
        .ok_or(AuthError::Forbidden)?;

    // 2. Verify org is member of requested dataspace
    let dataspaces = state.db.list_dataspaces_for_org(&membership.org_id).await;
    if !dataspaces.iter().any(|ds| ds.id == payload.dataspace_id) {
        return Err(AuthError::Forbidden);
    }

    // 3. Store in session
    session
        .insert("active_dataspace_id", &payload.dataspace_id)
        .await
        .map_err(|e| AuthError::Internal(format!("session insert: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /v1/auth/me
///
/// Returns the authenticated user's profile, org, and available dataspaces
/// with the effective role per dataspace ("promotor", "org_admin", or "org_user").
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
    let (org, dataspaces) = match &membership {
        Some(m) => {
            let org = state.db.get_organization(&m.org_id).await;
            let ds = state.db.list_dataspaces_for_org(&m.org_id).await;
            (org, ds)
        }
        None => (None, vec![]),
    };
    let active_dataspace_id: Option<String> =
        session.get::<String>("active_dataspace_id").await.ok().flatten();

    // Compute effective role per dataspace
    let membership_role = membership.as_ref().map(|m| m.role.as_str());
    let mut dataspaces_with_role = Vec::with_capacity(dataspaces.len());
    for ds in &dataspaces {
        let effective_role = if let Some(m) = &membership {
            match state.db.get_org_dataspace_role(&m.org_id, &ds.id).await {
                Some(DataspaceRole::Promotor) => "promotor",
                Some(DataspaceRole::Participant) => match m.role {
                    OrgRole::Admin => "org_admin",
                    OrgRole::User => "org_user",
                },
                None => "org_user",
            }
        } else {
            "org_user"
        };
        dataspaces_with_role.push(json!({
            "id": ds.id,
            "name": ds.name,
            "role": effective_role,
        }));
    }

    Ok(data_response(json!({
        "user_id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "membership_role": membership_role,
        "org": org.map(|o| json!({
            "id": o.id,
            "name": o.name,
        })),
        "dataspaces": dataspaces_with_role,
        "active_dataspace_id": active_dataspace_id,
    })))
}

/// PUT /v1/auth/password — change authenticated user's password.
///
/// Validates current password before allowing the change.
/// Protected by session_required.
#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    axum::Extension(auth_user): axum::Extension<crate::middleware::session_auth::AuthenticatedUser>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<impl IntoResponse, AuthError> {
    // 1. Load user
    let user = state
        .db
        .get_user(&auth_user.user_id)
        .await
        .ok_or(AuthError::Forbidden)?;

    // 2. Verify current password
    let ok = password::verify_password(
        payload.current_password.clone(),
        user.password_hash.clone(),
    )
    .await;
    if !ok {
        return Err(AuthError::InvalidCredentials);
    }

    // 3. Validate new password complexity
    password::validate_password(&payload.new_password)
        .map_err(|e| AuthError::ValidationFailed(e.to_string()))?;

    // 4. Hash new password
    let new_hash = password::hash_password(payload.new_password.clone()).await?;

    // 5. Update in DB
    state
        .db
        .update_user_password(&auth_user.user_id, &new_hash)
        .await
        .map_err(|e| AuthError::Internal(format!("update password: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
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
/// Returns 204 No Content regardless of whether the user was authenticated.
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

    Ok(StatusCode::NO_CONTENT)
}
