use std::collections::HashMap;
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::role::Member;
use crate::error::{data_response, error_body};
use crate::jobs::models::{Job, JobStatus};
use crate::jobs::routes::owned_job;

fn fail(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(error_body(code, message))).into_response()
}

/// The caller's job, once it has finished and its output can be read.
pub(crate) async fn output_ready(
    state: &AppState,
    member: &Member,
    id: &str,
) -> Result<Job, Response> {
    let job = owned_job(state, member, id)
        .await
        .map_err(IntoResponse::into_response)?;
    if job.status != JobStatus::Completed {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "not_completed",
            "Job is not completed yet",
        ));
    }
    Ok(job)
}

pub(crate) const SIGNED_URL_EXPIRES: Duration = Duration::from_secs(300);

#[derive(Serialize, utoipa::ToSchema)]
pub struct ResolveResponse {
    files: HashMap<String, String>,
}

/// Sign `files`, each relative to `base_url`, for `method` with `creds`.
pub(crate) async fn sign_dataset_paths(
    method: Method,
    base_url: &str,
    creds: &HashMap<String, String>,
    files: &[String],
) -> Result<Response, Response> {
    for f in files {
        crate::cloud::relative_path(f)
            .map_err(|e| fail(StatusCode::BAD_REQUEST, "invalid_path", e))?;
    }
    let (store, prefix) = crate::cloud::build_store(base_url, creds).map_err(|e| {
        fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "store_error",
            e.to_string(),
        )
    })?;

    let paths = files
        .iter()
        .map(|f| {
            let full = if prefix.as_ref().is_empty() {
                f.to_string()
            } else {
                format!("{prefix}/{f}")
            };
            object_store::path::Path::parse(&full)
                .map_err(|e| fail(StatusCode::BAD_REQUEST, "invalid_path", e.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let urls = store
        .sign_urls(method, &paths, SIGNED_URL_EXPIRES)
        .await
        .map_err(|e| {
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "sign_error",
                e.to_string(),
            )
        })?;

    let files = files
        .iter()
        .cloned()
        .zip(urls.into_iter().map(|u| u.to_string()))
        .collect();
    Ok(data_response(ResolveResponse { files }).into_response())
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct DatasetUrlsRequest {
    /// Paths relative to the dataset (or connection). The caller names them —
    /// the executor's output, the corpus reader's enumeration — and keasy signs
    /// the list it is handed.
    pub paths: Vec<String>,
}

/// Sign `paths` under the job's dataset, `{sink.url}/{job_id}` — the one path
/// keasy composes, because where a job's output lives is the host's decision.
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
    let (base, creds) = state
        .db
        .job_output_target(&job)
        .await
        .map_err(IntoResponse::into_response)?
        .ok_or_else(|| {
            fail(
                StatusCode::BAD_REQUEST,
                "no_destination",
                "The job's destination connection no longer exists",
            )
        })?;
    sign_dataset_paths(method, &crate::jobs::dataset_dest(&base, id), &creds, paths).await
}

#[utoipa::path(post, path = "/v1/jobs/{id}/output/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = DatasetUrlsRequest,
    responses(
        (status = 200, description = "Signed PUT URLs for the output keys", body = ResolveResponse),
        (status = 400, description = "The destination connection is gone, or a path outside the dataset"),
        (status = 404, description = "Job not found"),
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
        (status = 400, description = "The destination connection is gone, or a path outside the dataset"),
        (status = 404, description = "Job not found"),
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
