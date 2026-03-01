use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde_json::json;

use crate::AppState;
use crate::error::data_response;

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
    responses((status = 200, description = "External service status"))
)]
pub async fn service_status(State(state): State<AppState>) -> impl IntoResponse {
    data_response(json!({
        "wallet": state.gaia_x.vc_client.is_some(),
        "oidc": state.auth.oidc_state.is_some(),
        "gxdch_notary": !state.gaia_x.gxdch_notary_url.is_empty(),
        "gxdch_compliance": !state.gaia_x.gxdch_compliance_url.is_empty(),
    }))
}
