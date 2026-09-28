//! A job's dataset, `{sink.url}/{job_id}`: signed PUT URLs for the run that
//! writes it, and a stable URL per object for the reader that opens it.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use object_store::path::Path as ObjectPath;
use serde::{Deserialize, Serialize};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::Member;
use crate::domain::RelativePath;
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::jobs::owned;
use crate::routes::signed_redirect;
use crate::startup::AppState;
use crate::storage_client::{self, CloudStore, SIGNED_URL_EXPIRES};

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct DatasetUrlsRequest {
    /// Paths relative to the dataset: the executor's output, which keasy signs
    /// as it is handed.
    pub paths: Vec<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ResolveResponse {
    /// Dataset-relative path → signed URL.
    pub files: HashMap<String, String>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ObjectQuery {
    /// A path relative to the dataset (`vertex/Person/tiles.parquet`).
    pub path: String,
}

/// The store behind `member`'s job `id` and the dataset's root in it.
async fn dataset(
    state: &AppState,
    member: &Member,
    id: &str,
) -> Result<(CloudStore, ObjectPath), Refusal> {
    let job = owned(&state.db, &member.user_id, id).await?;
    let sink = crate::connections::persistence::get(&*state.db.read().await, &job.sink_connection)?
        .ok_or_else(|| {
            Refusal::new(
                StatusCode::BAD_REQUEST,
                ErrorCode::NoDestination,
                "The job's destination connection no longer exists",
            )
        })?;
    let (sink, credential) = crate::connections::storage(&state.db, &sink).await?;
    let base = job.output_under(&sink);
    let store = storage_client::store(&credential, &base)
        .map_err(|e| Refusal::new(StatusCode::INTERNAL_SERVER_ERROR, ErrorCode::StoreError, e))?;
    Ok((store, base.path().clone()))
}

fn object(root: &ObjectPath, path: &str) -> Result<ObjectPath, Refusal> {
    RelativePath::parse(path)
        .map(|path| path.under(root))
        .map_err(|e| Refusal::new(StatusCode::BAD_REQUEST, ErrorCode::InvalidPath, e))
}

fn sign_failed(e: object_store::Error) -> Refusal {
    Refusal::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        ErrorCode::SignError,
        e.to_string(),
    )
}

#[utoipa::path(post, path = "/v1/jobs/{id}/output/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = DatasetUrlsRequest,
    responses(
        (status = 200, description = "Signed PUT URLs for the output keys", body = ResolveResponse),
        (status = 400, description = "The destination connection is gone, or a path outside the dataset", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
    )
)]
/// Sign PUT URLs so the browser uploads the output it just produced straight to
/// the job's sink.
pub async fn resolve_output_urls(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<DatasetUrlsRequest>,
) -> Result<Json<ResolveResponse>, Refusal> {
    let (store, root) = dataset(&state, &member, &id).await?;
    let objects = req
        .paths
        .iter()
        .map(|p| object(&root, p))
        .collect::<Result<Vec<_>, _>>()?;
    let urls = store
        .sign_urls(Method::PUT, &objects, SIGNED_URL_EXPIRES)
        .await
        .map_err(sign_failed)?;
    Ok(Json(ResolveResponse {
        files: req
            .paths
            .into_iter()
            .zip(urls.into_iter().map(|u| u.to_string()))
            .collect(),
    }))
}

#[utoipa::path(get, path = "/v1/jobs/{id}/objects", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID"), ObjectQuery),
    responses(
        (status = 307, description = "To the object, signed for this request's method"),
        (status = 400, description = "The destination connection is gone, or a path outside the dataset", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
    )
)]
/// Read one object of the dataset: the URL a reader holds for as long as it
/// reads, which redirects to the store. GET and HEAD alike — a range reader
/// probes with HEAD, and S3 refuses one sent to a URL signed for GET.
pub async fn read_output_object(
    member: Member,
    method: Method,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ObjectQuery>,
) -> Result<Response, Refusal> {
    let (store, root) = dataset(&state, &member, &id).await?;
    let url = store
        .sign_url(method, &object(&root, &query.path)?, SIGNED_URL_EXPIRES)
        .await
        .map_err(sign_failed)?;
    Ok(signed_redirect(url))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(resolve_output_urls))
        .routes(routes!(read_output_object))
}
