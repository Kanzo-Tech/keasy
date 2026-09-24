use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use super::view::CatalogDataset;
use crate::AppState;
use crate::auth::role::Owner;
use crate::error::{data_response, error_body};

#[derive(Serialize, utoipa::ToSchema)]
pub struct DatasetsResponse {
    /// Every registered dataset in the workspace catalog.
    datasets: Vec<CatalogDataset>,
}

fn catalog_failure(detail: impl std::fmt::Display) -> Response {
    tracing::error!(error = %detail, "catalog read failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(error_body("catalog_error", "The catalog could not be read")),
    )
        .into_response()
}

#[utoipa::path(get, path = "/v1/catalog/datasets", tag = "Catalog",
    responses(
        (status = 200, description = "Registered datasets with their types/columns/rows", body = DatasetsResponse),
    )
)]
/// List the workspace catalog: every registered dataset (a completed job's
/// output) with its types, columns and row counts.
///
/// Governance metadata, and therefore the owner's: it is the index over what
/// the whole workspace produced. The member reaches their own output through
/// the job that made it, which carries the bytes; this carries none.
pub async fn list_catalog_datasets(
    _: Owner,
    State(state): State<AppState>,
) -> Result<Response, Response> {
    let catalog = state.catalog.clone();
    let mut datasets = tokio::task::spawn_blocking(move || catalog.datasets())
        .await
        .map_err(catalog_failure)?
        .map_err(catalog_failure)?;
    // Row counts are the corpus's own answer, stored on each job's relations.
    let jobs = state
        .db
        .list_jobs()
        .await
        .map_err(IntoResponse::into_response)?;
    super::view::fill_row_counts(&mut datasets, &jobs);
    Ok(data_response(DatasetsResponse { datasets }).into_response())
}
