use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;

use super::role::Roles;
use super::token::{TokenError, bearer};
use crate::error::Refusal;
use crate::startup::AppState;

/// Inserted into request extensions by [`bearer_required`]: who the caller is
/// and the roles they hold in the organization this instance serves, which the
/// role extractors read. No roles means not a member here, or a member holding
/// none of this application's roles.
#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    /// The Keycloak `sub`.
    pub user_id: String,
    /// What to call them where their work is shown ([`Claims::display_name`]).
    /// Personal data: stored with what they write, never logged.
    ///
    /// [`Claims::display_name`]: super::token::Claims::display_name
    pub name: String,
    pub roles: Roles,
}

/// Every protected route's front door: a verified bearer token, or nothing.
/// The role comes from the token itself, so it is as fresh as the token.
pub async fn bearer_required(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, Refusal> {
    let token = bearer(request.headers()).ok_or(TokenError::Missing)?;
    let claims = state.auth.verify(token).await?;
    tracing::Span::current().record("user_id", claims.sub.as_str());

    let roles = claims
        .org_roles(&state.org_alias, state.auth.client_id())
        .map(|names| Roles::from_claim(names.iter().map(String::as_str)))
        .unwrap_or_default();
    let span = tracing::Span::current();
    span.record("org", state.org_alias.as_str());
    span.record("roles", roles.to_string().as_str());

    request.extensions_mut().insert(AuthenticatedUser {
        name: claims.display_name(),
        user_id: claims.sub,
        roles,
    });
    Ok(next.run(request).await)
}
