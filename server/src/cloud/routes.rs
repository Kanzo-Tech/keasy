use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::AppState;
use crate::cloud::models::{CreateCloudAccountRequest, UpdateCloudAccountRequest};
use crate::error::data_response;
use crate::tenant::{placeholder_ctx, placeholder_scoped};

use super::errors::CloudAccountError;

pub async fn list_accounts(State(state): State<AppState>) -> Result<impl IntoResponse, CloudAccountError> {
    Ok(data_response(state.db.list_cloud_accounts(&placeholder_ctx()).await))
}

pub async fn create_account(
    State(state): State<AppState>,
    Json(payload): Json<CreateCloudAccountRequest>,
) -> Result<impl IntoResponse, CloudAccountError> {
    match state.db.create_cloud_account(&placeholder_ctx(), payload).await {
        Ok(summary) => Ok((StatusCode::CREATED, data_response(summary)).into_response()),
        Err(msg) => Err(CloudAccountError::ValidationFailed(msg)),
    }
}

pub async fn get_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, CloudAccountError> {
    match state.db.get_cloud_account_summary(&placeholder_scoped(id.as_str())).await {
        Some(summary) => Ok(data_response(summary).into_response()),
        None => Err(CloudAccountError::NotFound),
    }
}

pub async fn update_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateCloudAccountRequest>,
) -> Result<impl IntoResponse, CloudAccountError> {
    match state.db.update_cloud_account(&placeholder_scoped(id.as_str()), payload).await {
        Ok(summary) => Ok(data_response(summary).into_response()),
        Err(msg) => Err(CloudAccountError::ValidationFailed(msg)),
    }
}

pub async fn delete_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, CloudAccountError> {
    state.db.remove_cloud_account(&placeholder_scoped(id.as_str())).await;
    Ok(StatusCode::NO_CONTENT.into_response())
}
