//! Who may call a handler, read off the verified token.
//!
//! Two disjoint roles, not a hierarchy: the owner administers the workspace's
//! identity and catalog and never touches data; a member holds connections,
//! runs jobs and reads their output and administers nothing. A handler states
//! which it admits by taking [`Owner`], [`Member`] or [`AnyRole`].

use axum::Json;
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};

use super::bearer::AuthenticatedUser;
use crate::error::error_body;

/// A workspace role, from `resource_access.<client_id>.roles` on the token.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Role {
    Owner,
    Member,
}

/// Why a handler refused its caller. Opaque on purpose.
#[derive(Debug, thiserror::Error)]
pub enum RbacError {
    #[error("auth/session_required")]
    AuthRequired,
    #[error("rbac/no_membership")]
    NoMembership,
    #[error("rbac/insufficient_role")]
    InsufficientRole,
}

impl IntoResponse for RbacError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            RbacError::AuthRequired => (StatusCode::UNAUTHORIZED, "Authentication required"),
            RbacError::NoMembership => (
                StatusCode::FORBIDDEN,
                "No membership in this workspace found",
            ),
            RbacError::InsufficientRole => (StatusCode::FORBIDDEN, "Insufficient permissions"),
        };
        (status, Json(error_body(&self.to_string(), message))).into_response()
    }
}

/// The caller's role, or why there is none.
fn role(parts: &Parts) -> Result<(Role, &AuthenticatedUser), RbacError> {
    let user = parts
        .extensions
        .get::<AuthenticatedUser>()
        .ok_or(RbacError::AuthRequired)?;
    Ok((user.role.ok_or(RbacError::NoMembership)?, user))
}

/// Admits the workspace owner only.
pub struct Owner;

/// Admits a member only, and names them: a job belongs to the member who
/// created it.
pub struct Member {
    pub user_id: String,
}

/// Admits either role.
pub struct AnyRole;

impl<S: Send + Sync> FromRequestParts<S> for Owner {
    type Rejection = RbacError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, RbacError> {
        match role(parts)? {
            (Role::Owner, _) => Ok(Owner),
            _ => Err(RbacError::InsufficientRole),
        }
    }
}

impl<S: Send + Sync> FromRequestParts<S> for Member {
    type Rejection = RbacError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, RbacError> {
        match role(parts)? {
            (Role::Member, user) => Ok(Member {
                user_id: user.user_id.clone(),
            }),
            _ => Err(RbacError::InsufficientRole),
        }
    }
}

impl<S: Send + Sync> FromRequestParts<S> for AnyRole {
    type Rejection = RbacError;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, RbacError> {
        role(parts).map(|_| AnyRole)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use axum::http::Request;
    use axum::middleware::Next;
    use axum::routing::get;
    use tower::ServiceExt;

    async fn owner_only(_: Owner) -> &'static str {
        "identity, catalog storage, the data catalog"
    }
    async fn member_only(_: Member) -> &'static str {
        "connections, jobs, discovery, AI"
    }
    async fn either(_: AnyRole) -> &'static str {
        "the workspace's legal identity"
    }

    /// The three extractors, entered as `role`. A `None` role is a verified
    /// token with no role here; `user = false` is no token at all.
    fn app(user: bool, role: Option<Role>) -> Router {
        Router::new()
            .route("/owner", get(owner_only))
            .route("/member", get(member_only))
            .route("/either", get(either))
            .layer(axum::middleware::from_fn(
                move |mut request: Request<Body>, next: Next| async move {
                    if user {
                        let claims =
                            serde_json::from_value(serde_json::json!({ "sub": "u-1" })).unwrap();
                        request.extensions_mut().insert(AuthenticatedUser {
                            user_id: "u-1".to_string(),
                            role,
                            claims,
                        });
                    }
                    next.run(request).await
                },
            ))
    }

    async fn status(user: bool, role: Option<Role>, path: &str) -> StatusCode {
        app(user, role)
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status()
    }

    /// An owner touches no data anywhere in the product, so a member-only
    /// handler is not a privileged read for them — it is a refusal.
    #[tokio::test]
    async fn an_owner_is_refused_what_only_a_member_may_do() {
        assert_eq!(
            status(true, Some(Role::Owner), "/member").await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn a_member_is_refused_what_only_the_owner_may_do() {
        assert_eq!(
            status(true, Some(Role::Member), "/owner").await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn each_role_is_admitted_to_its_own() {
        assert_eq!(
            status(true, Some(Role::Owner), "/owner").await,
            StatusCode::OK
        );
        assert_eq!(
            status(true, Some(Role::Member), "/member").await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn either_role_is_admitted_where_both_are() {
        assert_eq!(
            status(true, Some(Role::Owner), "/either").await,
            StatusCode::OK
        );
        assert_eq!(
            status(true, Some(Role::Member), "/either").await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn a_token_without_a_workspace_role_is_admitted_nowhere() {
        for path in ["/owner", "/member", "/either"] {
            assert_eq!(
                status(true, None, path).await,
                StatusCode::FORBIDDEN,
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn without_a_verified_token_nothing_answers() {
        for path in ["/owner", "/member", "/either"] {
            assert_eq!(
                status(false, None, path).await,
                StatusCode::UNAUTHORIZED,
                "{path}"
            );
        }
    }
}
