use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;

use crate::AppState;
use crate::error::data_response;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/healthz/live", get(liveness))
        .route("/healthz/ready", get(readiness))
}

pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/status", get(service_status))
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ServiceStatusResponse {
    pub oidc: bool,
    pub gxdch_notary: bool,
    pub gxdch_compliance: bool,
    pub base_domain: Option<String>,
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

#[utoipa::path(get, path = "/v1/status", tag = "Health",
    responses((status = 200, description = "External service status", body = ServiceStatusResponse))
)]
pub async fn service_status(State(state): State<AppState>) -> impl IntoResponse {
    data_response(ServiceStatusResponse {
        oidc: state.auth.oidc_state.is_some(),
        gxdch_notary: true,
        gxdch_compliance: true,
        base_domain: state.gaia_x.base_domain.clone(),
    })
}
