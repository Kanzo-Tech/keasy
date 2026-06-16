// server/src/catalog/routes.rs — the governance read API over the catalog.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use super::view::CatalogDataset;
use crate::AppState;
use crate::error::error_body;
use crate::middleware::tenant::{IsMember, Require};

#[derive(Serialize, utoipa::ToSchema)]
pub struct DatasetsResponse {
    /// Every registered dataset in the workspace catalog.
    datasets: Vec<CatalogDataset>,
}

#[utoipa::path(get, path = "/v1/catalog/datasets", tag = "Catalog",
    responses(
        (status = 200, description = "Registered datasets with their types/columns/rows", body = DatasetsResponse),
        (status = 503, description = "Catalog unavailable"),
    )
)]
/// List the workspace catalog: every registered dataset (a completed job's
/// output) with its types, columns and row counts. Governance metadata — open to
/// every member (the IDS/Solid model: members discover the space at the metadata
/// level, the bytes stay producer-scoped).
pub async fn list_catalog_datasets(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
) -> Response {
    let Some(catalog) = state.catalog.clone() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(error_body("catalog_unavailable", "Catalog is not available")),
        )
            .into_response();
    };

    match tokio::task::spawn_blocking(move || catalog.datasets()).await {
        Ok(Ok(mut datasets)) => {
            // Enrich with row counts from the authoritative job manifests (keeps
            // the catalog read pure-metadata + credential-free).
            super::view::fill_row_counts(&mut datasets, &state.db.list_jobs().await);
            Json(DatasetsResponse { datasets }).into_response()
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_body("catalog_error", e.to_string())),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_body("catalog_error", e.to_string())),
        )
            .into_response(),
    }
}
