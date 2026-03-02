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
use crate::error::error_body;
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
    /// Create a TenantScoped<T> from this context, scoped to the org.
    pub fn scoped<T>(&self, inner: T) -> crate::tenant::TenantScoped<T> {
        crate::tenant::TenantScoped::new(self.org_id.clone(), inner)
    }

    /// Create a TenantScoped<()> for list queries that only need org_id.
    pub fn as_ctx(&self) -> crate::tenant::TenantScoped<()> {
        crate::tenant::TenantScoped::new(self.org_id.clone(), ())
    }
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

/// Extractor: requires the org to be Promotor of the instance.
/// Rejects: OrgAdmin, OrgUser.
#[allow(dead_code)]
pub struct RequirePromotor(pub TenantContext);

impl<S> FromRequestParts<S> for RequirePromotor
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
        if ctx.role == TenantRole::Promotor {
            Ok(Self(ctx))
        } else {
            Err(RbacError::InsufficientRole)
        }
    }
}

/// Extractor: any participant user (admin or regular). Rejects promotor.
#[allow(dead_code)]
pub struct RequireParticipant(pub TenantContext);

impl<S> FromRequestParts<S> for RequireParticipant
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
        if ctx.role == TenantRole::Promotor {
            Err(RbacError::InsufficientRole)
        } else {
            Ok(Self(ctx))
        }
    }
}

/// Extractor: participant org admin only. Rejects promotor and OrgUser.
#[allow(dead_code)]
pub struct RequireOrgAdmin(pub TenantContext);

impl<S> FromRequestParts<S> for RequireOrgAdmin
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
        if ctx.role == TenantRole::OrgAdmin {
            Ok(Self(ctx))
        } else {
            Err(RbacError::InsufficientRole)
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
) -> Result<Response, RbacError> {
    // 1. Extract AuthenticatedUser inserted by session_required
    let user = request
        .extensions()
        .get::<AuthenticatedUser>()
        .cloned()
        .ok_or(RbacError::AuthRequired)?;

    // 2. Get org membership
    let member = state
        .db
        .get_org_membership(&user.user_id)
        .await
        .ok_or(RbacError::NoMembership)?;

    // 3. Get the org to read its role (promotor/participant)
    let org = state
        .db
        .get_organization(&member.org_id)
        .await
        .ok_or(RbacError::NoMembership)?;

    // 4. Determine TenantRole
    let role = if org.role == "promotor" {
        TenantRole::Promotor
    } else {
        match member.role.as_str() {
            "admin" => TenantRole::OrgAdmin,
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
