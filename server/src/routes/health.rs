use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

use crate::AppState;

pub async fn liveness() -> impl IntoResponse {
    StatusCode::OK
}

pub async fn readiness(State(state): State<AppState>) -> impl IntoResponse {
    if state.runner.available_permits() > 0 {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

pub async fn service_status(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({ "data": {
        "wallet": state.vc_client.is_some(),
        "oidc": state.oidc_state.is_some(),
        "gxdch_notary": !state.gxdch_notary_url.is_empty(),
        "gxdch_compliance": !state.gxdch_compliance_url.is_empty(),
    }}))
}
