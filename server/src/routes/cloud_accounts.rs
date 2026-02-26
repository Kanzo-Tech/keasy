use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::AppState;
use crate::settings::types::{CreateCloudAccountRequest, UpdateCloudAccountRequest};
use crate::tenant::TenantScoped;

use super::error_response;

/// Phase 1 placeholder — Phase 4 middleware replaces this with real session context.
fn placeholder_ctx() -> crate::tenant::TenantContext {
    TenantScoped::placeholder()
}

/// Phase 1 placeholder scoped around a value — Phase 4 middleware replaces this.
fn placeholder_scoped<T: Clone>(inner: T) -> TenantScoped<T> {
    TenantScoped::placeholder_with(inner)
}

pub async fn list_accounts(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.db.list_cloud_accounts(&placeholder_ctx()).await)
}

pub async fn create_account(
    State(state): State<AppState>,
    Json(payload): Json<CreateCloudAccountRequest>,
) -> Response {
    match state.db.create_cloud_account(&placeholder_ctx(), payload).await {
        Ok(summary) => (StatusCode::CREATED, Json(summary)).into_response(),
        Err(msg) => error_response(StatusCode::BAD_REQUEST, "validation_error", msg),
    }
}

pub async fn get_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.db.get_cloud_account_summary(&placeholder_scoped(id.as_str())).await {
        Some(summary) => (StatusCode::OK, Json(summary)).into_response(),
        None => error_response(StatusCode::NOT_FOUND, "not_found", "Cloud account not found"),
    }
}

pub async fn update_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateCloudAccountRequest>,
) -> Response {
    match state.db.update_cloud_account(&placeholder_scoped(id.as_str()), payload).await {
        Ok(summary) => (StatusCode::OK, Json(summary)).into_response(),
        Err(msg) => error_response(StatusCode::BAD_REQUEST, "validation_error", msg),
    }
}

pub async fn delete_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    state.db.remove_cloud_account(&placeholder_scoped(id.as_str())).await;
    StatusCode::NO_CONTENT.into_response()
}
