use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;

use super::jwt::{Claims, TokenError, bearer};
use super::role::Role;
use crate::AppState;

/// Inserted into request extensions by [`bearer_required`]: who the caller is
/// and the one role they hold here, which the role extractors read.
#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    /// The Keycloak `sub`.
    pub user_id: String,
    /// The role this person holds on **this** workspace's client. `None` means
    /// authenticated but not a member of this workspace.
    pub role: Option<Role>,
    /// The verified claims, for the workspace slugs behind the switcher.
    pub claims: Claims,
}

/// Every protected route's front door: a verified bearer token, or nothing.
/// The role comes from the token itself, so it is as fresh as the token.
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
/// it, so this reads the claim and does not rank it — and `web/src/lib/roles.ts`
/// reads the same claim to the same three answers.
///
/// Both roles at once is a provisioning error (`var.tenants` refuses an email
/// listed in `owners` **and** in `members`), but a realm edited by hand could
/// still produce one — and a token carrying two disjoint roles carries neither.
fn role_from(roles: &[String]) -> Option<Role> {
    let owner = roles.iter().any(|r| r == "owner");
    let member = roles.iter().any(|r| r == "member");
    match (owner, member) {
        (true, false) => Some(Role::Owner),
        (false, true) => Some(Role::Member),
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
    fn each_role_is_read_from_its_own_claim() {
        assert_eq!(role_from(&roles(&["owner"])), Some(Role::Owner));
        assert_eq!(role_from(&roles(&["member"])), Some(Role::Member));
    }

    #[test]
    fn a_token_with_no_workspace_role_carries_none() {
        assert_eq!(role_from(&[]), None);
        assert_eq!(role_from(&roles(&["uma_authorization"])), None);
    }

    /// The roles are disjoint, so there is no "highest" of the two to pick.
    /// Ranking them here is what would quietly hand an owner the data.
    #[test]
    fn both_roles_at_once_is_neither() {
        assert_eq!(role_from(&roles(&["owner", "member"])), None);
        assert_eq!(role_from(&roles(&["member", "owner"])), None);
    }
}
