use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::AppState;
use crate::settings::types::{CreateCloudAccountRequest, UpdateCloudAccountRequest};

use super::error_response;

pub async fn list_accounts(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.cloud_accounts.list())
}

pub async fn create_account(
    State(state): State<AppState>,
    Json(payload): Json<CreateCloudAccountRequest>,
) -> Response {
    match state.cloud_accounts.create(payload) {
        Ok(summary) => (StatusCode::CREATED, Json(summary)).into_response(),
        Err(msg) => error_response(StatusCode::BAD_REQUEST, "validation_error", msg),
    }
}

pub async fn get_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.cloud_accounts.get_summary(&id) {
        Some(summary) => (StatusCode::OK, Json(summary)).into_response(),
        None => error_response(StatusCode::NOT_FOUND, "not_found", "Cloud account not found"),
    }
}

pub async fn update_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateCloudAccountRequest>,
) -> Response {
    match state.cloud_accounts.update(&id, payload) {
        Ok(summary) => (StatusCode::OK, Json(summary)).into_response(),
        Err(msg) => error_response(StatusCode::BAD_REQUEST, "validation_error", msg),
    }
}

pub async fn delete_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    state.cloud_accounts.remove(&id);
    StatusCode::NO_CONTENT.into_response()
}
