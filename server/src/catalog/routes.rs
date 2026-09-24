// server/src/catalog/routes.rs — the governance read API over the catalog.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use super::view::CatalogDataset;
use crate::AppState;
use crate::auth::role::Owner;
use crate::error::error_body;

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
/// output) with its types, columns and row counts.
///
/// Governance metadata, and therefore the owner's: Data Catalog is a page on the
/// owner's side of the app (`/datasets`), and it is the index over what the
/// whole workspace produced rather than over what the caller produced. The
/// member reaches their own output through the job that made it, which carries
/// the bytes; this carries none.
pub async fn list_catalog_datasets(_: Owner, State(state): State<AppState>) -> Response {
    let Some(catalog) = state.catalog.clone() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(error_body(
                "catalog_unavailable",
                "Catalog is not available",
            )),
        )
            .into_response();
    };

    match tokio::task::spawn_blocking(move || catalog.datasets()).await {
        Ok(Ok(mut datasets)) => {
            // Enrich with row counts from the authoritative job manifests (keeps
            // the catalog read pure-metadata + credential-free).
            match state.db.list_jobs().await {
                Ok(jobs) => {
                    super::view::fill_row_counts(&mut datasets, &jobs);
                    Json(DatasetsResponse { datasets }).into_response()
                }
                Err(e) => e.into_response(),
            }
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
