use std::collections::HashMap;
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::role::Member;
use crate::connections::models::Connection;
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

const SIGNED_URL_EXPIRES: Duration = Duration::from_secs(300);

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

#[derive(Serialize, utoipa::ToSchema)]
struct SourceRefsResponse {
    /// Connection ref-map `{ name: baseUrl }`, so the executor resolves
    /// `@name/path` to `{baseUrl}/path`.
    refs: HashMap<String, String>,
}

#[utoipa::path(get, path = "/v1/jobs/{id}/source-refs", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Connection ref-map for the job's sources", body = SourceRefsResponse),
        (status = 404, description = "Job not found"),
    )
)]
/// The job's connection ref-map (name → base URL). No credentials: signing is
/// a separate, per-URL call.
pub async fn resolve_source_refs(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, Response> {
    let refs = job_connections(&state, &member, &id)
        .await?
        .into_iter()
        .map(|c| (c.name, c.url))
        .collect();
    Ok(data_response(SourceRefsResponse { refs }).into_response())
}

/// The connections the caller's job reads, as far as they still exist.
async fn job_connections(
    state: &AppState,
    member: &Member,
    id: &str,
) -> Result<Vec<Connection>, Response> {
    let job = owned_job(state, member, id)
        .await
        .map_err(IntoResponse::into_response)?;
    let mut connections = Vec::with_capacity(job.connection_ids.len());
    for cid in &job.connection_ids {
        if let Some(c) = state
            .db
            .get_connection(cid)
            .await
            .map_err(IntoResponse::into_response)?
        {
            connections.push(c);
        }
    }
    Ok(connections)
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SourceUrlsRequest {
    /// The resolved source URIs (`s3://bucket/prefix/users.csv`).
    uris: Vec<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
struct SourceUrlsResponse {
    /// Each URI → a fetch URL: signed GET for cloud sources, the URI itself for
    /// public HTTP ones.
    urls: HashMap<String, String>,
}

/// Whether `uri` names an object under the connection rooted at `base`.
fn under(uri: &str, base: &str) -> bool {
    let base = base.trim_end_matches('/');
    uri.strip_prefix(base)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

#[utoipa::path(post, path = "/v1/jobs/{id}/sources/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = SourceUrlsRequest,
    responses(
        (status = 200, description = "Fetch URLs (signed GET for cloud) per source URI", body = SourceUrlsResponse),
        (status = 404, description = "Job not found"),
    )
)]
/// Sign GET URLs so the browser fetches the program's cloud sources directly.
/// Each cloud URI is signed with the credentials of the job connection it lies
/// under (the deepest one); public HTTP URIs pass through.
pub async fn resolve_source_urls(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<SourceUrlsRequest>,
) -> Result<Response, Response> {
    let conns = job_connections(&state, &member, &id).await?;

    let mut urls = HashMap::with_capacity(req.uris.len());
    for uri in &req.uris {
        if !crate::cloud::is_cloud_url(uri) {
            urls.insert(uri.clone(), uri.clone());
            continue;
        }
        let creds = match conns
            .iter()
            .filter(|c| under(uri, &c.url))
            .max_by_key(|c| c.url.len())
        {
            Some(conn) => state
                .db
                .connection_credentials(conn)
                .await
                .map_err(IntoResponse::into_response)?,
            None => HashMap::new(),
        };
        let (store, path) = crate::cloud::build_store(uri, &creds)
            .map_err(|e| fail(StatusCode::BAD_REQUEST, "store_error", e.to_string()))?;
        let signed = store
            .sign_url(Method::GET, &path, SIGNED_URL_EXPIRES)
            .await
            .map_err(|e| {
                fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "sign_error",
                    e.to_string(),
                )
            })?;
        urls.insert(uri.clone(), signed.to_string());
    }
    Ok(data_response(SourceUrlsResponse { urls }).into_response())
}

#[cfg(test)]
mod tests {
    use super::under;

    #[test]
    fn a_source_is_under_a_connection_only_at_a_path_boundary() {
        assert!(under("s3://b/data/x.csv", "s3://b/data"));
        assert!(under("s3://b/data/x.csv", "s3://b/data/"));
        assert!(under("s3://b/data", "s3://b/data"));
        assert!(!under("s3://b/data-private/x.csv", "s3://b/data"));
    }
}
