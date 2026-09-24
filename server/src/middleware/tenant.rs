use std::marker::PhantomData;
use std::ops::Deref;

use axum::Json;
use axum::body::Body;
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use thiserror::Error;

use crate::error::error_body;
use crate::middleware::bearer::AuthenticatedUser;

/// Role assigned to a tenant context. Two **disjoint** roles, not a hierarchy:
/// an owner administers people, identity and the catalog and has no data plane;
/// a member runs jobs, holds the connections and opens Discovery and
/// administers nothing. Neither contains the other.
///
/// Read from `resource_access.<client_id>.roles` on the verified bearer token —
/// Keycloak's own claim, scoped to this workspace's client. Both roles are
/// declared at provisioning (`var.tenants`), which is also where holding both
/// at once is refused.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TenantRole {
    /// Workspace owner — the control plane: identity, catalog, people.
    Owner,
    /// Workspace member — the data plane: connections, jobs, discovery.
    Member,
}

/// Authenticated request context. Injected into request extensions by
/// `tenant_context_required` middleware. Route handlers extract this via
/// `Require<P>` (`Require<IsOwner>`, `Require<IsDataPlane>`,
/// `Require<IsWorkspaceUser>`). With one workspace per instance the context
/// carries the caller's role and identity.
#[derive(Clone, Debug)]
pub struct TenantContext {
    pub role: TenantRole,
    /// Keycloak `sub` of the authenticated member (from `AuthenticatedUser`).
    /// Attributes resources to their creator — e.g. a job's output lands under
    /// `{substrate}/{user_id}/{job_id}` (logical data-product ownership).
    pub user_id: String,
}

/// RBAC error type. All 403 responses are intentionally opaque.
#[derive(Debug, Error)]
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
        match self {
            RbacError::AuthRequired => (
                StatusCode::UNAUTHORIZED,
                Json(error_body(
                    "auth/session_required",
                    "Authentication required",
                )),
            )
                .into_response(),

            RbacError::NoMembership => (
                StatusCode::FORBIDDEN,
                Json(error_body(
                    "rbac/no_membership",
                    "No organization membership found",
                )),
            )
                .into_response(),

            RbacError::InsufficientRole => (
                StatusCode::FORBIDDEN,
                Json(error_body(
                    "rbac/insufficient_role",
                    "Insufficient permissions",
                )),
            )
                .into_response(),
        }
    }
}

// ── Sealed Policy trait system ─────────────────────────────────────────────

mod sealed {
    pub trait Sealed {}
}

/// A policy that determines whether a `TenantRole` is allowed.
pub trait Policy: sealed::Sealed + Send + Sync + 'static {
    fn is_allowed(role: &TenantRole) -> bool;
}

macro_rules! define_policy {
    ($(#[$meta:meta])* $name:ident, |$role:ident| $body:expr) => {
        $(#[$meta])*
        pub struct $name;
        impl sealed::Sealed for $name {}
        impl Policy for $name {
            fn is_allowed($role: &TenantRole) -> bool { $body }
        }
    };
}

// The three predicates are the two planes and the ground they share. There is no
// fourth, and no policy admits both planes' surfaces at once: that is what
// "disjoint" means, and it is stated here rather than spelled out per handler.

define_policy!(
    /// The control plane — workspace owner only. Identity, catalog storage, the
    /// data catalog: metadata about the workspace and the people in it.
    IsOwner, |role| *role == TenantRole::Owner
);
define_policy!(
    /// The data plane — workspace member only. Connections, jobs, discovery, the
    /// AI surfaces over a job's output, and the cloud accounts they run on.
    ///
    /// The owner is refused here on purpose. The planes are disjoint, so an
    /// owner reaching `/v1/jobs` is not a privileged read — it is a request the
    /// web already refuses to draw, and the server is the half that decides.
    IsDataPlane, |role| *role == TenantRole::Member
);
define_policy!(
    /// Neither plane in particular: a verified token carrying **some** role on
    /// this workspace. The few surfaces both planes stand on — UI preferences,
    /// and reading the workspace's legal identity (the owner edits it on the
    /// Identity page; the member's job studio reads it to know whether DCAT
    /// output can be published at all).
    IsWorkspaceUser, |_role| true
);

/// Generic policy-based extractor. Replaces `RequireOwner`, `RequireParticipant`,
/// and `RequireOrgAdmin` with a single `Require<P>` type.
pub struct Require<P: Policy> {
    ctx: TenantContext,
    _p: PhantomData<P>,
}

impl<P: Policy> Deref for Require<P> {
    type Target = TenantContext;
    fn deref(&self) -> &Self::Target {
        &self.ctx
    }
}

impl<S, P: Policy> FromRequestParts<S> for Require<P>
where
    S: Send + Sync,
{
    type Rejection = RbacError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let ctx = parts
            .extensions
            .get::<TenantContext>()
            .cloned()
            .ok_or(RbacError::AuthRequired)?;
        if P::is_allowed(&ctx.role) {
            Ok(Self {
                ctx,
                _p: PhantomData,
            })
        } else {
            Err(RbacError::InsufficientRole)
        }
    }
}

/// Middleware: resolves TenantContext from the authenticated user's role and
/// injects it into extensions.
///
/// Must run AFTER `bearer_required` (which inserts AuthenticatedUser carrying
/// the role read from `resource_access.<client_id>.roles`). A user with no role
/// is authenticated but not a workspace member → 403.
pub async fn tenant_context_required(
    mut request: axum::http::Request<Body>,
    next: Next,
) -> Result<Response, RbacError> {
    let user = request
        .extensions()
        .get::<AuthenticatedUser>()
        .cloned()
        .ok_or(RbacError::AuthRequired)?;

    let role = user.role.ok_or(RbacError::NoMembership)?;

    request.extensions_mut().insert(TenantContext {
        role,
        user_id: user.user_id,
    });

    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::http::{Request, StatusCode};
    use axum::routing::get;
    use tower::ServiceExt;

    // Three handlers, one per policy, behind the same `Require<P>` extractor
    // every real handler uses — so what is asserted below is what a request
    // would actually meet.
    async fn control_plane(_: Require<IsOwner>) -> &'static str {
        "identity, catalog storage, the data catalog"
    }
    async fn data_plane(_: Require<IsDataPlane>) -> &'static str {
        "connections, jobs, discovery, AI"
    }
    async fn common_ground(_: Require<IsWorkspaceUser>) -> &'static str {
        "preferences, the workspace's legal identity"
    }

    /// The three surfaces, entered as `role`. On a real request
    /// `tenant_context_required` is what puts this context here; placing it
    /// directly keeps the test about the policies and nothing else.
    fn app(role: Option<TenantRole>) -> Router {
        Router::new()
            .route("/control", get(control_plane))
            .route("/data", get(data_plane))
            .route("/common", get(common_ground))
            .layer(axum::middleware::from_fn(
                move |mut request: axum::http::Request<Body>, next: Next| async move {
                    if let Some(role) = role {
                        request.extensions_mut().insert(TenantContext {
                            role,
                            user_id: "u-1".to_string(),
                        });
                    }
                    next.run(request).await
                },
            ))
    }

    async fn status(role: Option<TenantRole>, path: &str) -> StatusCode {
        app(role)
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .expect("the router answers")
            .status()
    }

    /// The bug this arrangement exists to close: `IsMember` admitted
    /// `Owner | Member`, so an owner — who has no data plane anywhere in the
    /// product — could call every data-plane endpoint the web refuses to draw.
    #[tokio::test]
    async fn an_owner_is_refused_the_data_plane() {
        assert_eq!(
            status(Some(TenantRole::Owner), "/data").await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn a_member_is_refused_the_control_plane() {
        assert_eq!(
            status(Some(TenantRole::Member), "/control").await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn each_plane_answers_its_own_role() {
        assert_eq!(
            status(Some(TenantRole::Owner), "/control").await,
            StatusCode::OK
        );
        assert_eq!(
            status(Some(TenantRole::Member), "/data").await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn the_common_ground_answers_both() {
        assert_eq!(
            status(Some(TenantRole::Owner), "/common").await,
            StatusCode::OK
        );
        assert_eq!(
            status(Some(TenantRole::Member), "/common").await,
            StatusCode::OK
        );
    }

    /// No tenant context at all — a request that never passed
    /// `tenant_context_required`. Every policy refuses; none of them guesses.
    #[tokio::test]
    async fn without_a_workspace_role_nothing_answers() {
        for path in ["/control", "/data", "/common"] {
            assert_eq!(status(None, path).await, StatusCode::UNAUTHORIZED, "{path}");
        }
    }
}
