use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use axum::extract::State;
use axum::middleware::Next;
use axum::body::Body;
use tower_sessions::Session;
use thiserror::Error;

use crate::AppState;
use crate::error::error_body;
use crate::middleware::session_auth::AuthenticatedUser;
use crate::db::dataspaces::{DataspaceRole, OrgRole};
use crate::tenant::OrgId;

/// Flat role assigned to a tenant context. No hierarchy — each variant
/// is distinct. Promotor is the org that manages a dataspace. OrgAdmin/OrgUser
/// reflect the user's role within their org.
#[derive(Clone, Debug, PartialEq)]
pub enum TenantRole {
    /// Org is promotor of the active dataspace
    Promotor,
    /// User has admin role in their org
    OrgAdmin,
    /// User has regular user role in their org
    OrgUser,
}

/// Authenticated, tenant-scoped request context. Injected into request
/// extensions by `tenant_context_required` middleware. Route handlers
/// extract this via `RequireRole`, `RequirePromotor`, or `RequireOrgAdmin`.
#[derive(Clone, Debug)]
pub struct TenantContext {
    pub org_id: OrgId,
    pub dataspace_id: String,
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

    #[error("rbac/no_active_dataspace")]
    NoActiveDataspace,

    #[error("rbac/no_active_dataspace")]
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

            RbacError::NoActiveDataspace | RbacError::NoMembership => (
                StatusCode::FORBIDDEN,
                Json(error_body(
                    "rbac/no_active_dataspace",
                    "No active dataspace selected",
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

/// Extractor: requires an active tenant context. Used for all authenticated
/// resource endpoints. Extracts TenantContext from request extensions
/// (inserted by tenant_context_required middleware).
#[allow(dead_code)]
pub struct RequireRole(pub TenantContext);

impl<S> FromRequestParts<S> for RequireRole
where
    S: Send + Sync,
{
    type Rejection = RbacError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<TenantContext>()
            .cloned()
            .map(RequireRole)
            .ok_or(RbacError::AuthRequired)
    }
}

/// Extractor: requires the org to be Promotor of the active dataspace.
#[allow(dead_code)]
pub struct RequirePromotor(pub TenantContext);

impl<S> FromRequestParts<S> for RequirePromotor
where
    S: Send + Sync,
{
    type Rejection = RbacError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let RequireRole(ctx) = RequireRole::from_request_parts(parts, state).await?;
        if ctx.role == TenantRole::Promotor {
            Ok(RequirePromotor(ctx))
        } else {
            Err(RbacError::InsufficientRole)
        }
    }
}

/// Extractor: requires the user to be OrgAdmin or Promotor.
/// Promotor is included because managing a dataspace implies org-admin capabilities.
#[allow(dead_code)]
pub struct RequireOrgAdmin(pub TenantContext);

impl<S> FromRequestParts<S> for RequireOrgAdmin
where
    S: Send + Sync,
{
    type Rejection = RbacError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let RequireRole(ctx) = RequireRole::from_request_parts(parts, state).await?;
        if ctx.role == TenantRole::Promotor || ctx.role == TenantRole::OrgAdmin {
            Ok(RequireOrgAdmin(ctx))
        } else {
            Err(RbacError::InsufficientRole)
        }
    }
}

/// Middleware: resolves TenantContext from session and DB, injects into extensions.
///
/// Must run AFTER session_required (which inserts AuthenticatedUser).
/// Reads active_dataspace_id from session, validates org membership, and
/// determines the tenant role before passing to the next handler.
#[allow(dead_code)]
pub async fn tenant_context_required(
    session: Session,
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

    // 2. Read active_dataspace_id from session
    let dataspace_id: String = session
        .get::<String>("active_dataspace_id")
        .await
        .ok()
        .flatten()
        .ok_or(RbacError::NoActiveDataspace)?;

    // 3. Get user's org membership
    let membership = state
        .db
        .get_user_org_membership(&user.user_id)
        .await
        .ok_or(RbacError::NoMembership)?;

    // 4. Verify org is member of the requested dataspace
    let dataspace_role = state
        .db
        .get_org_dataspace_role(&membership.org_id, &dataspace_id)
        .await
        .ok_or_else(|| {
            tracing::warn!(
                user_id = %user.user_id,
                dataspace_id = %dataspace_id,
                org_id = %membership.org_id,
                "tenant isolation: user attempted dataspace but org has no membership"
            );
            RbacError::NoMembership
        })?;

    // 5. Determine TenantRole
    let role = match dataspace_role {
        DataspaceRole::Promotor => TenantRole::Promotor,
        DataspaceRole::Participant => match membership.role {
            OrgRole::Admin => TenantRole::OrgAdmin,
            OrgRole::User => TenantRole::OrgUser,
        },
    };

    // 6. Build TenantContext
    let ctx = TenantContext {
        org_id: OrgId(membership.org_id.clone()),
        dataspace_id,
        role,
    };

    // 7. Insert into extensions
    request.extensions_mut().insert(ctx);

    // 8. Continue
    Ok(next.run(request).await)
}
