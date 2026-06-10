use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use tower_sessions::Session;

use crate::AppState;
use crate::auth::errors::AuthError;
use crate::middleware::tenant::TenantRole;

/// Inserted into request extensions by session_required middleware.
/// Downstream handlers extract this for the authenticated user's ID and role.
#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub user_id: String,
    /// Tenant role from the `keasy:role` claim, captured at login. `None` means
    /// the user is authenticated but not a workspace member.
    pub role: Option<TenantRole>,
}

/// Middleware that requires a valid session with a "user_id" key AND
/// verifies the session is the current active session for that user.
///
/// Applied to all protected routes via `middleware::from_fn_with_state`.
///
/// Behavior:
/// 1. Session has user_id → cross-check session_id against user_sessions table
///    - If session_id matches → pass through (AuthenticatedUser stored in request extensions)
///    - If session_id does NOT match → this is an orphaned/stale session from a
///      previous login; flush it and return 401 "auth/session_required"
/// 2. No session / no user_id → 401 with appropriate error code
///
/// This enforces the CONTEXT.md locked decision: "Single active session per user —
/// new login invalidates any previous session."
pub async fn session_required(
    session: Session,
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AuthError> {
    match session.get::<String>("user_id").await {
        Ok(Some(user_id)) => {
            // Cross-check: is this session still the active one for this user?
            // The login handler upserts user_sessions with the new session_id,
            // so any previous session_id becomes stale.
            let current_session_id = session.id().map(|id| id.to_string());
            let active_session_id = state.db.get_user_session_id(&user_id).await;

            match (current_session_id, active_session_id) {
                (Some(current), Some(active)) if current == active => {
                    // Session is the active one — allow through. Capture the
                    // tenant role stashed at login from the `keasy:role` claim.
                    let role = session
                        .get::<String>("tenant_role")
                        .await
                        .ok()
                        .flatten()
                        .and_then(|r| match r.as_str() {
                            "owner" => Some(TenantRole::Owner),
                            "member" => Some(TenantRole::Member),
                            _ => None,
                        });
                    request
                        .extensions_mut()
                        .insert(AuthenticatedUser { user_id, role });
                    Ok(next.run(request).await)
                }
                _ => {
                    // Session is stale (user logged in elsewhere) or no active
                    // session exists. Flush the orphaned session data from the store
                    // so the browser doesn't keep sending it.
                    let _ = session.flush().await;
                    Err(AuthError::SessionRequired)
                }
            }
        }
        Ok(None) => {
            // Session exists but no user_id — could be expired or never authenticated
            if session.is_empty().await {
                Err(AuthError::SessionRequired)
            } else {
                Err(AuthError::SessionExpired)
            }
        }
        Err(_) => {
            // Session store error — treat as unauthenticated
            Err(AuthError::SessionRequired)
        }
    }
}
