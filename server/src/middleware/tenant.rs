use std::marker::PhantomData;
use std::ops::Deref;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::response::Response;
use axum::extract::State;
use axum::middleware::Next;
use axum::body::Body;

use crate::AppState;
use crate::error::AppError;
use crate::org::models::MemberRole;
use crate::middleware::session_auth::AuthenticatedUser;
use crate::tenant::OrgId;

/// Flat role assigned to a tenant context. No hierarchy — each variant
/// is distinct. Promotor is the org that manages the instance. OrgAdmin/OrgUser
/// reflect the user's role within their org.
#[derive(Clone, Debug, PartialEq)]
pub enum TenantRole {
    /// Org is promotor of the instance
    Promotor,
    /// User has admin role in their org
    OrgAdmin,
    /// User has regular user role in their org
    OrgUser,
}

/// Authenticated, tenant-scoped request context. Injected into request
/// extensions by `tenant_context_required` middleware. Route handlers
/// extract this via `RequireParticipant`, `RequirePromotor`, or `RequireOrgAdmin`.
#[derive(Clone, Debug)]
pub struct TenantContext {
    pub org_id: OrgId,
    pub role: TenantRole,
}

impl TenantContext {
    pub fn tenant(&self) -> crate::tenant::Tenant {
        crate::tenant::Tenant { org_id: self.org_id.clone() }
    }
    pub fn resource<'a>(&'a self, id: &'a str) -> crate::tenant::TenantResource<'a> {
        crate::tenant::TenantResource { org_id: &self.org_id, id }
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
    /// Any authenticated user with a tenant context (promotor, admin, or user).
    AnyRole, |_role| true
);
define_policy!(
    /// Promotor only — Metadata Broker role (IDS-RAM 4.0).
    IsPromotor, |role| *role == TenantRole::Promotor
);
define_policy!(
    /// Any participant user (OrgAdmin or OrgUser). Rejects promotor.
    IsParticipant, |role| matches!(role, TenantRole::OrgAdmin | TenantRole::OrgUser)
);
define_policy!(
    /// Participant org admin only. Rejects promotor and OrgUser.
    IsAdmin, |role| *role == TenantRole::OrgAdmin
);
define_policy!(
    /// Promotor or participant admin. Rejects OrgUser.
    IsAdminOrPromotor, |role| matches!(role, TenantRole::OrgAdmin | TenantRole::Promotor)
);

/// Generic policy-based extractor. Replaces `RequirePromotor`, `RequireParticipant`,
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
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let ctx = parts
            .extensions
            .get::<TenantContext>()
            .cloned()
            .ok_or(AppError::Unauthorized)?;
        if P::is_allowed(&ctx.role) {
            Ok(Self { ctx, _p: PhantomData })
        } else {
            Err(AppError::Forbidden("insufficient permissions".into()))
        }
    }
}

/// Middleware: resolves TenantContext from session and DB, injects into extensions.
///
/// Must run AFTER session_required (which inserts AuthenticatedUser).
/// Reads the user's org membership and determines tenant role from
/// organizations.role and user_org_memberships.role.
#[allow(dead_code)]
pub async fn tenant_context_required(
    State(state): State<AppState>,
    mut request: axum::http::Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    // 1. Extract AuthenticatedUser inserted by session_required
    let user = request
        .extensions()
        .get::<AuthenticatedUser>()
        .cloned()
        .ok_or(AppError::Unauthorized)?;

    // 2. Get org membership
    let member = state
        .repos
        .get_org_membership(&user.user_id)
        .await
        .ok_or(AppError::Forbidden("no organization membership".into()))?;

    // 3. Get the org to read its role (promotor/participant)
    let org = state
        .repos
        .get_organization(&member.org_id)
        .await
        .ok_or(AppError::Forbidden("no organization membership".into()))?;

    // 4. Determine TenantRole
    let role = if org.role == "promotor" {
        TenantRole::Promotor
    } else {
        match member.role.parse::<MemberRole>() {
            Ok(MemberRole::Admin) => TenantRole::OrgAdmin,
            _ => TenantRole::OrgUser,
        }
    };

    // 5. Build TenantContext
    let ctx = TenantContext {
        org_id: OrgId(member.org_id),
        role,
    };

    // 6. Insert into extensions
    request.extensions_mut().insert(ctx);

    // 7. Continue
    Ok(next.run(request).await)
}
