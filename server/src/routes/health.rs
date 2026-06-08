use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::AppState;
use crate::error::data_response;

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ServiceStatusResponse {
    pub oidc: bool,
}

#[utoipa::path(get, path = "/healthz/live", tag = "Health",
    responses((status = 200, description = "Service is alive"))
)]
pub async fn liveness() -> impl IntoResponse {
    StatusCode::OK
}

#[utoipa::path(get, path = "/healthz/ready", tag = "Health",
    responses(
        (status = 200, description = "Service is ready"),
        (status = 503, description = "Service is not ready"),
    )
)]
pub async fn readiness(State(state): State<AppState>) -> impl IntoResponse {
    if state.runner.available_permits() > 0 {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

/// The running build's version — announced so operators (and the fleet view) can
/// see exactly which image a tenant is on. `git_sha`/`built_at` are stamped at
/// build time (CI sets `KEASY_GIT_SHA`/`KEASY_BUILT_AT`); `version` is the crate
/// version. See [[project_keasy_swarm_deploy_architecture]] (W0.6).
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

#[utoipa::path(get, path = "/v1/status", tag = "Health",
    responses((status = 200, description = "External service status", body = ServiceStatusResponse))
)]
pub async fn service_status(State(state): State<AppState>) -> impl IntoResponse {
    data_response(ServiceStatusResponse {
        oidc: state.auth.oidc_state.is_some(),
    })
}
