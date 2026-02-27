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
use crate::db::organizations::OrgRole;
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

/// GET /v1/auth/me
///
/// Returns the authenticated user's profile, org, and effective role.
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
    let org = match &membership {
        Some(m) => state.db.get_organization(&m.org_id).await,
        None => None,
    };

    // Read auth_method from session — "vc" if authenticated via OID4VP, "oidc" otherwise.
    // OIDC is now the primary auth method; the "password" fallback is removed since
    // password auth is being deleted in Phase 11 (IDENT-07).
    let auth_method: String = session
        .get::<String>("auth_method")
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "oidc".to_string());

    // Read whether the walt.id Verifier sidecar is currently reachable
    let vc_available = state.vc_available.load(std::sync::atomic::Ordering::Relaxed);

    // Compute effective role
    let membership_role = membership.as_ref().map(|m| m.role.as_str());
    let effective_role = match (&org, &membership) {
        (Some(o), Some(_)) if o.role == "promotor" => "promotor",
        (_, Some(m)) => match m.role {
            OrgRole::Admin => "org_admin",
            OrgRole::User => "org_user",
        },
        _ => "org_user",
    };

    Ok(data_response(json!({
        "user_id": user.id,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "membership_role": membership_role,
        "effective_role": effective_role,
        "auth_method": auth_method,
        "vc_available": vc_available,
        "org": org.map(|o| json!({
            "id": o.id,
            "name": o.name,
            "role": o.role,
            "vc_verified_at": o.vc_verified_at,
        })),
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
/// Returns 200 with `end_session_url` — the Keycloak end-session URL for full
/// single logout. The frontend redirects the browser to this URL to complete
/// the OIDC RP-Initiated Logout flow.
///
/// If OIDC is not configured, `end_session_url` is null and the caller only
/// needs to clear the local session (existing password/VC behavior is preserved).
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

    // Build Keycloak end-session URL for OIDC RP-Initiated Logout.
    // Format: {issuer}/protocol/openid-connect/logout?client_id={id}&post_logout_redirect_uri={url}
    let end_session_url = if let (Some(oidc), Some(client_id)) =
        (&state.oidc_state, &state.oidc_client_id)
    {
        let post_logout_uri = format!("{}/login", state.base_url.trim_end_matches('/'));
        let encoded_redirect = urlencoding::encode(&post_logout_uri);
        Some(format!(
            "{}/protocol/openid-connect/logout?client_id={}&post_logout_redirect_uri={}",
            oidc.issuer_url, client_id, encoded_redirect
        ))
    } else {
        None
    };

    Ok(data_response(json!({ "end_session_url": end_session_url })))
}
