use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::net::SocketAddr;
use time::OffsetDateTime;
use tower_sessions::{Expiry, Session};

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::auth::models::{LoginRequest, RegisterRequest};
use crate::auth::password;
use crate::db::users::{User, UserStatus};
use crate::error::data_response;

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

    // Store in user_sessions for single-session enforcement
    let session_id = session
        .id()
        .ok_or_else(|| AuthError::Internal("session has no ID after cycle_id".to_string()))?
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

    // 7. Enforce single session — AFTER cycle_id so we store the new session_id
    // The old session_id in user_sessions is atomically replaced. The old session
    // data remains in the tower-sessions store until it expires naturally (24h),
    // but session_required middleware will reject it immediately since its session_id
    // no longer matches the active entry in user_sessions.
    let session_id = session
        .id()
        .ok_or_else(|| AuthError::Internal("session has no ID after cycle_id".to_string()))?
        .to_string();

    state
        .db
        .upsert_user_session(&user.id, &session_id)
        .await
        .map_err(|e| AuthError::Internal(format!("upsert_user_session failed: {e}")))?;

    // 8. Return 200 with user_id
    Ok(data_response(json!({ "user_id": user.id })))
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
