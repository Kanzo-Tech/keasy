use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::error::data_response;

#[utoipa::path(get, path = "/healthz/live", tag = "Health",
    responses((status = 200, description = "Service is alive"))
)]
pub async fn liveness() -> impl IntoResponse {
    StatusCode::OK
}

#[utoipa::path(get, path = "/healthz/ready", tag = "Health",
    responses((status = 200, description = "Service is ready"))
)]
pub async fn readiness() -> impl IntoResponse {
    // Client-compute: the server runs no mappings, so readiness has no execution
    // capacity to gate on — it is ready whenever it is serving.
    StatusCode::OK
}

/// The running build's version, so an operator can see which image a tenant is
/// on. `git_sha`/`built_at` are stamped at build time (CI sets `KEASY_GIT_SHA`/
/// `KEASY_BUILT_AT`); `version` is the crate version.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct VersionResponse {
    pub version: &'static str,
    pub git_sha: Option<&'static str>,
    pub built_at: Option<&'static str>,
}

#[utoipa::path(get, path = "/version", tag = "Health",
    responses((status = 200, description = "Running build version", body = VersionResponse))
)]
pub async fn version() -> impl IntoResponse {
    data_response(VersionResponse {
        version: env!("CARGO_PKG_VERSION"),
        git_sha: option_env!("KEASY_GIT_SHA"),
        built_at: option_env!("KEASY_BUILT_AT"),
    })
}
