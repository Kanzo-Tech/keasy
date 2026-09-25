//! Signed URLs under a job's dataset, `{sink.url}/{job_id}`: PUT for the run
//! that writes it, GET for the reader that opens it.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::jobs::{DatasetUrlsRequest, ResolveResponse};
use crate::api::{ErrorBody, ErrorCode};

use crate::AppState;
use crate::authentication::role::Member;
use crate::domain::StorageUrl;
use crate::error::Refusal;
use crate::routes::jobs::owned_job;
use crate::storage_client::{self, SIGNED_URL_EXPIRES, relative_path};

async fn sign_dataset_urls(
    method: Method,
    state: &AppState,
    member: &Member,
    id: &str,
    paths: &[String],
) -> Result<Response, Response> {
    let job = owned_job(state, member, id)
        .await
        .map_err(IntoResponse::into_response)?;
    let signed = async {
        let sink =
            crate::connections::persistence::get(&*state.db.read().await, &job.sink_connection)?
                .ok_or_else(|| {
                    Refusal::new(
                        StatusCode::BAD_REQUEST,
                        ErrorCode::NoDestination,
                        "The job's destination connection no longer exists",
                    )
                })?;
        let (sink_url, credential) = crate::connections::storage(&state.db, &sink).await?;
        let base = StorageUrl::parse(&crate::jobs::dataset_dest(sink_url.as_ref(), id))
            .map_err(Refusal::invalid)?;
        let store = storage_client::store(&credential, &base).map_err(|e| {
            Refusal::new(StatusCode::INTERNAL_SERVER_ERROR, ErrorCode::StoreError, e)
        })?;
        let mut objects = Vec::with_capacity(paths.len());
        for p in paths {
            relative_path(p)
                .map_err(|e| Refusal::new(StatusCode::BAD_REQUEST, ErrorCode::InvalidPath, e))?;
            objects.push(base.path().child(p.as_str()));
        }
        let urls = store
            .sign_urls(method, &objects, SIGNED_URL_EXPIRES)
            .await
            .map_err(|e| {
                Refusal::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ErrorCode::SignError,
                    e.to_string(),
                )
            })?;
        Ok::<_, Refusal>(ResolveResponse {
            files: paths
                .iter()
                .cloned()
                .zip(urls.into_iter().map(|u| u.to_string()))
                .collect(),
        })
    };
    signed
        .await
        .map(|r| Json(r).into_response())
        .map_err(IntoResponse::into_response)
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
) -> Result<Response, Response> {
    sign_dataset_urls(Method::PUT, &state, &member, &id, &req.paths).await
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = DatasetUrlsRequest,
    responses(
        (status = 200, description = "Signed GET URLs for the requested dataset keys", body = ResolveResponse),
        (status = 400, description = "The destination connection is gone, or a path outside the dataset", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
    )
)]
/// Sign GET URLs so the browser reads the dataset directly — the reading twin of
/// [`resolve_output_urls`]. It takes the list the corpus reader enumerated and
/// derives none.
pub async fn resolve_discover_urls(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<DatasetUrlsRequest>,
) -> Result<Response, Response> {
    sign_dataset_urls(Method::GET, &state, &member, &id, &req.paths).await
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(resolve_output_urls))
        .routes(routes!(resolve_discover_urls))
}
