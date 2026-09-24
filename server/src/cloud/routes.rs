use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::AppState;
use crate::auth::role::{AnyRole, Member};
use crate::cloud::models::{
    CloudAccountSummary, CreateCloudAccountRequest, UpdateCloudAccountRequest,
};
use crate::error::data_response;

use super::errors::CloudAccountError;

// The one cloud-accounts call that is not the member's alone.
//
// A cloud account is a member's: they add it, edit it and delete it from
// Settings → Cloud Accounts, which is a member-only page. But the owner's
// Catalog Storage page has to *name* one to say where the catalog is published,
// and it names it by picking from this list — so the owner reads it and does
// nothing else with it. The summary is a name and an id; the credential lives
// behind the encrypted secret and is not in this response.
#[utoipa::path(get, path = "/v1/cloud-accounts", tag = "Cloud Accounts",
    responses((status = 200, description = "List of cloud accounts", body = Vec<CloudAccountSummary>))
)]
pub async fn list_accounts(
    _: AnyRole,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, CloudAccountError> {
    Ok(data_response(state.db.list_cloud_accounts().await?))
}

#[utoipa::path(post, path = "/v1/cloud-accounts", tag = "Cloud Accounts",
    request_body = CreateCloudAccountRequest,
    responses(
        (status = 201, description = "Cloud account created", body = CloudAccountSummary),
        (status = 400, description = "Validation failed"),
    )
)]
pub async fn create_account(
    _: Member,
    State(state): State<AppState>,
    Json(payload): Json<CreateCloudAccountRequest>,
) -> Result<impl IntoResponse, CloudAccountError> {
    let summary = state.db.create_cloud_account(payload).await?;
    Ok((StatusCode::CREATED, data_response(summary)))
}

#[utoipa::path(get, path = "/v1/cloud-accounts/{id}", tag = "Cloud Accounts",
    params(("id" = String, Path, description = "Cloud account ID")),
    responses(
        (status = 200, description = "Cloud account details", body = CloudAccountSummary),
        (status = 404, description = "Cloud account not found"),
    )
)]
pub async fn get_account(
    _: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, CloudAccountError> {
    state
        .db
        .get_cloud_account_summary(&id)
        .await?
        .map(data_response)
        .ok_or(CloudAccountError::NotFound)
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
    _: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateCloudAccountRequest>,
) -> Result<impl IntoResponse, CloudAccountError> {
    Ok(data_response(
        state.db.update_cloud_account(&id, payload).await?,
    ))
}

#[utoipa::path(delete, path = "/v1/cloud-accounts/{id}", tag = "Cloud Accounts",
    params(("id" = String, Path, description = "Cloud account ID")),
    responses((status = 204, description = "Cloud account deleted"))
)]
pub async fn delete_account(
    _: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, CloudAccountError> {
    state.db.remove_cloud_account(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}
