use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use crate::AppState;
use crate::cloud::models::{CloudAccountSummary, CreateCloudAccountRequest, UpdateCloudAccountRequest};
use crate::error::data_response;
use crate::middleware::tenant::{IsAdminOrOwner, Require};

use super::errors::CloudAccountError;

#[utoipa::path(get, path = "/v1/cloud-accounts", tag = "Cloud Accounts",
    responses((status = 200, description = "List of cloud accounts", body = Vec<CloudAccountSummary>))
)]
pub async fn list_accounts(
    ctx: Require<IsAdminOrOwner>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, CloudAccountError> {
    Ok(data_response(state.db.list_cloud_accounts(&ctx.as_ctx()).await))
}

#[utoipa::path(post, path = "/v1/cloud-accounts", tag = "Cloud Accounts",
    request_body = CreateCloudAccountRequest,
    responses(
        (status = 201, description = "Cloud account created", body = CloudAccountSummary),
        (status = 400, description = "Validation failed"),
    )
)]
pub async fn create_account(
    ctx: Require<IsAdminOrOwner>,
    State(state): State<AppState>,
    Json(payload): Json<CreateCloudAccountRequest>,
) -> Result<impl IntoResponse, CloudAccountError> {
    match state.db.create_cloud_account(&ctx.as_ctx(), payload).await {
        Ok(summary) => Ok((StatusCode::CREATED, data_response(summary)).into_response()),
        Err(msg) => Err(CloudAccountError::ValidationFailed(msg)),
    }
}

#[utoipa::path(get, path = "/v1/cloud-accounts/{id}", tag = "Cloud Accounts",
    params(("id" = String, Path, description = "Cloud account ID")),
    responses(
        (status = 200, description = "Cloud account details", body = CloudAccountSummary),
        (status = 404, description = "Cloud account not found"),
    )
)]
pub async fn get_account(
    ctx: Require<IsAdminOrOwner>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, CloudAccountError> {
    match state.db.get_cloud_account_summary(&ctx.scoped(id.as_str())).await {
        Some(summary) => Ok(data_response(summary).into_response()),
        None => Err(CloudAccountError::NotFound),
    }
}

#[utoipa::path(put, path = "/v1/cloud-accounts/{id}", tag = "Cloud Accounts",
    params(("id" = String, Path, description = "Cloud account ID")),
    request_body = UpdateCloudAccountRequest,
    responses(
        (status = 200, description = "Cloud account updated", body = CloudAccountSummary),
        (status = 400, description = "Validation failed"),
    )
)]
pub async fn update_account(
    ctx: Require<IsAdminOrOwner>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateCloudAccountRequest>,
) -> Result<impl IntoResponse, CloudAccountError> {
    match state.db.update_cloud_account(&ctx.scoped(id.as_str()), payload).await {
        Ok(summary) => Ok(data_response(summary).into_response()),
        Err(msg) => Err(CloudAccountError::ValidationFailed(msg)),
    }
}

#[utoipa::path(delete, path = "/v1/cloud-accounts/{id}", tag = "Cloud Accounts",
    params(("id" = String, Path, description = "Cloud account ID")),
    responses((status = 204, description = "Cloud account deleted"))
)]
pub async fn delete_account(
    ctx: Require<IsAdminOrOwner>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, CloudAccountError> {
    state.db.remove_cloud_account(&ctx.scoped(id.as_str())).await;
    Ok(StatusCode::NO_CONTENT.into_response())
}
