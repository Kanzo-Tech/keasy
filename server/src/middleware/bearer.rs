use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;

use crate::AppState;
use crate::auth::jwt::{Claims, TokenError, bearer};
use crate::middleware::tenant::TenantRole;

/// Inserted into request extensions by [`bearer_required`]. Downstream handlers
/// read the caller's identity from it; `Require<P>` reads the role.
#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    /// The Keycloak `sub`.
    pub user_id: String,
    /// The role this person holds on **this** workspace's client. `None` means
    /// authenticated but not a member of this workspace.
    pub role: Option<TenantRole>,
    /// The rest of the verified claims, for the handful of handlers that draw
    /// from them — the profile, and the workspace slugs behind the switcher.
    pub claims: Claims,
}

/// Every protected route's front door: a verified bearer token, or nothing.
///
/// There is no session and no store lookup. What used to be a cookie, a row in
/// `user_sessions` and a role stashed at login is one signature check against
/// the realm's JWKS — and the role comes from the token itself, so it is as
/// fresh as the token rather than as fresh as the login.
pub async fn bearer_required(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, TokenError> {
    let token = bearer(request.headers()).ok_or(TokenError::Missing)?;
    let claims = state.auth.verify(token).await?;

    // Hierarchical: owner ⊇ member. That `owner` outranks `member` is a fact
    // about this product, so this product spells it out.
    let roles = claims.roles_for(state.auth.client_id());
    let role = if roles.iter().any(|r| r == "owner") {
        Some(TenantRole::Owner)
    } else if roles.iter().any(|r| r == "member") {
        Some(TenantRole::Member)
    } else {
        None
    };

    request.extensions_mut().insert(AuthenticatedUser {
        user_id: claims.sub.clone(),
        role,
        claims,
    });
    Ok(next.run(request).await)
}
