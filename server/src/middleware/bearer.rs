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
    tracing::Span::current().record("user_id", claims.sub.as_str());

    let role = role_from(claims.roles_for(state.auth.client_id()));
    if role.is_none() {
        tracing::debug!(
            sub = %claims.sub,
            client = %state.auth.client_id(),
            "verified token carries no single workspace role"
        );
    }

    request.extensions_mut().insert(AuthenticatedUser {
        user_id: claims.sub.clone(),
        role,
        claims,
    });
    Ok(next.run(request).await)
}

/// The workspace role a token's client-role claim carries, if it carries one.
///
/// Disjoint, not hierarchical: `owner` does not contain `member`, it excludes
/// it. Each plane is closed to the other, so this reads the claim and does not
/// rank it — and `web/src/lib/roles.ts` reads the same claim to the same three
/// answers, which is the whole agreement between the two halves.
///
/// Both roles at once is a provisioning error rather than a state to resolve
/// here (`var.tenants` refuses an email listed in `owners` **and** in
/// `members`), but a realm edited by hand could still produce one — and a token
/// carrying two disjoint planes carries neither.
fn role_from(roles: &[String]) -> Option<TenantRole> {
    let owner = roles.iter().any(|r| r == "owner");
    let member = roles.iter().any(|r| r == "member");
    match (owner, member) {
        (true, false) => Some(TenantRole::Owner),
        (false, true) => Some(TenantRole::Member),
        (true, true) | (false, false) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roles(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn each_plane_is_read_from_its_own_role() {
        assert_eq!(role_from(&roles(&["owner"])), Some(TenantRole::Owner));
        assert_eq!(role_from(&roles(&["member"])), Some(TenantRole::Member));
    }

    #[test]
    fn a_token_with_no_workspace_role_carries_none() {
        assert_eq!(role_from(&[]), None);
        assert_eq!(role_from(&roles(&["uma_authorization"])), None);
    }

    /// The planes are disjoint, so there is no "highest" of the two to pick.
    /// Ranking them here is what would quietly hand an owner the data plane.
    #[test]
    fn both_roles_at_once_is_neither() {
        assert_eq!(role_from(&roles(&["owner", "member"])), None);
        assert_eq!(role_from(&roles(&["member", "owner"])), None);
    }
}
