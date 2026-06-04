use std::marker::PhantomData;
use std::ops::Deref;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use axum::extract::State;
use axum::middleware::Next;
use axum::body::Body;
use thiserror::Error;

use crate::AppState;
use crate::db::org_members::MemberRole;
use crate::error::error_body;
use crate::middleware::session_auth::AuthenticatedUser;

/// Role assigned to a tenant context. Two hierarchical roles: `Owner` ⊇
/// `Member`. The owner is bootstrapped from config (W7); everyone else joins
/// as a member via an invite link (Slack/Discord-style membership).
#[derive(Clone, Debug, PartialEq)]
pub enum TenantRole {
    /// Workspace owner — bootstrapped from config, can invite + administer.
    Owner,
    /// Regular workspace member — joined via invite link.
    Member,
}

/// Authenticated request context. Injected into request extensions by
/// `tenant_context_required` middleware. Route handlers extract this via
/// `Require<P>` (e.g. `Require<IsOwner>`, `Require<IsMember>`). With one
/// workspace per instance the context carries only the member's role.
#[derive(Clone, Debug)]
pub struct TenantContext {
    pub role: TenantRole,
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

    #[error("internal")]
    Internal(String),
}

impl IntoResponse for RbacError {
    fn into_response(self) -> Response {
        match self {
            RbacError::AuthRequired => (
                StatusCode::UNAUTHORIZED,
                Json(error_body("auth/session_required", "Authentication required")),
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
                Json(error_body("rbac/insufficient_role", "Insufficient permissions")),
            )
                .into_response(),

            RbacError::Internal(detail) => {
                tracing::error!(detail = %detail, "RBAC internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_body("internal_error", "An internal error occurred")),
                )
                    .into_response()
            }
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

define_policy!(
    /// Workspace owner only — invite + administer surfaces.
    IsOwner, |role| *role == TenantRole::Owner
);
define_policy!(
    /// Any authenticated workspace user (owner or member) — the data surface.
    /// Roles are hierarchical, so the owner passes too.
    IsMember, |role| matches!(role, TenantRole::Owner | TenantRole::Member)
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
            Ok(Self { ctx, _p: PhantomData })
        } else {
            Err(RbacError::InsufficientRole)
        }
    }
}

/// Middleware: resolves TenantContext from session and DB, injects into extensions.
///
/// Must run AFTER session_required (which inserts AuthenticatedUser).
/// Reads the user's membership and determines the tenant role from
/// `org_members.role` (`owner` → Owner, else Member).
#[allow(dead_code)]
pub async fn tenant_context_required(
    State(state): State<AppState>,
    mut request: axum::http::Request<Body>,
    next: Next,
) -> Result<Response, RbacError> {
    // 1. Extract AuthenticatedUser inserted by session_required
    let user = request
        .extensions()
        .get::<AuthenticatedUser>()
        .cloned()
        .ok_or(RbacError::AuthRequired)?;

    // 2. Get membership (the sole source of the tenant role)
    let member = state
        .db
        .get_org_membership(&user.user_id)
        .await
        .ok_or(RbacError::NoMembership)?;

    // 3. Determine TenantRole from the membership role
    let role = match member.role.parse::<MemberRole>() {
        Ok(MemberRole::Owner) => TenantRole::Owner,
        _ => TenantRole::Member,
    };

    // 4. Build and inject the TenantContext
    request.extensions_mut().insert(TenantContext { role });

    Ok(next.run(request).await)
}
