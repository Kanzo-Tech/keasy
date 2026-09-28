use axum::Json;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Serialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::startup::AppState;

/// The running build's version, so an operator can see which image a tenant is
/// on. `git_sha`/`built_at` are stamped at build time (CI sets `KEASY_GIT_SHA`/
/// `KEASY_BUILT_AT`); `version` is the crate version.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct VersionResponse {
    pub version: &'static str,
    pub git_sha: Option<&'static str>,
    pub built_at: Option<&'static str>,
}

#[utoipa::path(get, path = "/healthz/live", tag = "Health", security(()),
    responses((status = 200, description = "Service is alive"))
)]
pub async fn liveness() -> impl IntoResponse {
    StatusCode::OK
}

#[utoipa::path(get, path = "/healthz/ready", tag = "Health", security(()),
    responses((status = 200, description = "Service is ready"))
)]
pub async fn readiness() -> impl IntoResponse {
    // Client-compute: the server runs no mappings, so readiness has no execution
    // capacity to gate on — it is ready whenever it is serving.
    StatusCode::OK
}

#[utoipa::path(get, path = "/version", tag = "Health", security(()),
    responses((status = 200, description = "Running build version", body = VersionResponse))
)]
pub async fn version() -> impl IntoResponse {
    Json(VersionResponse {
        version: env!("CARGO_PKG_VERSION"),
        git_sha: option_env!("KEASY_GIT_SHA"),
        built_at: option_env!("KEASY_BUILT_AT"),
    })
}

/// Public: probes and the build stamp.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(liveness))
        .routes(routes!(readiness))
        .routes(routes!(version))
}
