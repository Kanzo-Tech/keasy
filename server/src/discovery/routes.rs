use std::collections::HashMap;
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::Method;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::error_body;
use crate::jobs::models::{Job, JobStatus};
use crate::middleware::tenant::{IsDataPlane, Require};

/// Data sovereignty: only the job's producer (`created_by`) may read or run its
/// DATA — its sources and its output. The CATALOG (governance metadata) stays
/// open to every member: the owner discovers the space at the metadata level,
/// never the bytes (IDS/Solid model).
fn forbid_non_producer(job: &Job, user_id: &str) -> Option<Response> {
    (job.created_by != user_id).then(|| {
        (
            StatusCode::FORBIDDEN,
            Json(error_body(
                "not_producer",
                "Only the data producer can access this dataset's data",
            )),
        )
            .into_response()
    })
}

/// Checks that output is ready and returns Ok(()) or appropriate error.
pub(crate) async fn require_output_ready(state: &AppState, job_id: &str) -> Result<(), Response> {
    let job = state.db.get_job(job_id).await.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "Job not found")),
        )
            .into_response()
    })?;

    if job.status != JobStatus::Completed {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(error_body("not_completed", "Job is not completed yet")),
        )
            .into_response());
    }

    Ok(())
}

// ── Shared URL signing ──────────────────────────────────────────────────

const SIGNED_URL_EXPIRES: Duration = Duration::from_secs(300);

#[derive(Serialize, utoipa::ToSchema)]
struct ResolveResponse {
    files: HashMap<String, String>,
}

/// Sign the given dataset-relative paths under `base_url` for `method`, with the
/// creds of the job's output target (the connection the member chose, or the
/// substrate fallback), so reads and writes are signed against the right store.
async fn sign_dataset_paths(
    method: Method,
    base_url: &str,
    creds: &HashMap<String, String>,
    files: &[String],
) -> Result<Response, Response> {
    let (store, prefix) = crate::cloud::build_store(base_url, creds).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_body("store_error", e.to_string())),
        )
            .into_response()
    })?;

    let all_files: Vec<String> = files.to_vec();

    let mut paths = Vec::with_capacity(all_files.len());
    for f in &all_files {
        let full = if prefix.as_ref().is_empty() {
            f.to_string()
        } else {
            format!("{prefix}/{f}")
        };
        let p = object_store::path::Path::parse(&full).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("path_error", e.to_string())),
            )
                .into_response()
        })?;
        paths.push(p);
    }

    let urls = store
        .sign_urls(method, &paths, SIGNED_URL_EXPIRES)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("sign_error", e.to_string())),
            )
                .into_response()
        })?;

    let files: HashMap<String, String> = all_files
        .into_iter()
        .zip(urls.into_iter().map(|u| u.to_string()))
        .collect();

    Ok(Json(ResolveResponse { files }).into_response())
}

// ── Dataset URLs (signed PUT to write, signed GET to read) ──────────

#[derive(Deserialize, utoipa::ToSchema)]
pub struct DatasetUrlsRequest {
    /// Dataset-relative keys. On the write side they are what the executor
    /// produced; on the read side they are what the corpus reader enumerated.
    /// **Either way the caller names them and keasy does not** — the host signs
    /// the list it is handed.
    paths: Vec<String>,
}

/// Sign `paths` under the job's dataset for `method`. The dataset lives at
/// `{dest_base}/{job_id}`, where `dest_base` is the connection the member chose
/// as the destination (`sink_connection_id`) or the workspace substrate
/// fallback — the one path keasy composes, because where a job's output lives
/// is the host's decision.
async fn sign_dataset_urls(
    method: Method,
    state: &AppState,
    user_id: &str,
    id: &str,
    paths: &[String],
) -> Response {
    let Some(job) = state.db.get_job(id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "Job not found")),
        )
            .into_response();
    };
    if let Some(resp) = forbid_non_producer(&job, user_id) {
        return resp;
    }
    let Some((base, creds)) = state.db.job_output_target(&job).await else {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body(
                "no_destination",
                "No output destination configured — pick one in the job config",
            )),
        )
            .into_response();
    };
    let dest = crate::jobs::dataset_dest(&base, id);

    match sign_dataset_paths(method, &dest, &creds, paths).await {
        Ok(resp) | Err(resp) => resp,
    }
}

#[utoipa::path(post, path = "/v1/jobs/{id}/output/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = DatasetUrlsRequest,
    responses(
        (status = 200, description = "Signed PUT URLs for the output keys", body = ResolveResponse),
        (status = 400, description = "No data space substrate configured"),
        (status = 404, description = "Job not found"),
    )
)]
/// Sign PUT URLs so the browser uploads the output it just produced directly to
/// the member's chosen destination (no data through the server).
pub async fn resolve_output_urls(
    ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<DatasetUrlsRequest>,
) -> Response {
    sign_dataset_urls(Method::PUT, &state, &ctx.user_id, &id, &req.paths).await
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = DatasetUrlsRequest,
    responses(
        (status = 200, description = "Signed GET URLs for the requested dataset keys", body = ResolveResponse),
        (status = 400, description = "No data space substrate configured"),
        (status = 404, description = "Job not found"),
    )
)]
/// Sign GET URLs so the browser reads the dataset directly — the reading twin
/// of [`resolve_output_urls`], same handler, other verb.
///
/// **It takes the list; it does not derive one.** It used to walk the run report
/// and hand back `manifest.vertices[].file` + `manifest.edges[].by_source`,
/// which is the host restating a layout it does not own — and restating it
/// wrongly, since those were names the layout pass deletes. What is addressable
/// is the corpus reader's answer, so the caller enumerates and keasy signs.
pub async fn resolve_discover_urls(
    ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<DatasetUrlsRequest>,
) -> Response {
    sign_dataset_urls(Method::GET, &state, &ctx.user_id, &id, &req.paths).await
}

// ── Browser source access (ref-map + signed GET) ───────────────────────────

#[derive(Serialize, utoipa::ToSchema)]
struct SourceRefsResponse {
    /// Connection ref-map `{ name: baseUrl }` — the browser passes it to the
    /// executor (`@fossil-lang/executor`) so `@name/path` source aliases resolve
    /// to `{baseUrl}/path`, identically to the native engine.
    refs: HashMap<String, String>,
}

#[utoipa::path(get, path = "/v1/jobs/{id}/source-refs", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Connection ref-map for the job's sources", body = SourceRefsResponse),
        (status = 404, description = "Job not found"),
    )
)]
/// The job's connection ref-map (name → base URL). The browser feeds it to the
/// executor's `sources()`/`run()` to resolve `@conn` aliases. No credentials —
/// only the base URLs (signing is a separate, per-URL call).
pub async fn resolve_source_refs(
    ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let Some(job) = state.db.get_job(id.as_str()).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "Job not found")),
        )
            .into_response();
    };
    if let Some(resp) = forbid_non_producer(&job, &ctx.user_id) {
        return resp;
    }
    let mut refs = HashMap::new();
    for cid in &job.connection_ids {
        if let Some(c) = state.db.get_connection(cid).await {
            refs.insert(c.name, c.url);
        }
    }
    Json(SourceRefsResponse { refs }).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SourceUrlsRequest {
    /// The RESOLVED source URIs the executor's `sources()` returned (already
    /// `@conn`-resolved, e.g. `s3://bucket/prefix/users.csv`).
    uris: Vec<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
struct SourceUrlsResponse {
    /// Each input URI → a fetch URL: a signed GET for cloud sources, or the URI
    /// verbatim for public/HTTP ones. The browser fetches each and stages the
    /// bytes for the executor under the SAME URI.
    urls: HashMap<String, String>,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/sources/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = SourceUrlsRequest,
    responses(
        (status = 200, description = "Fetch URLs (signed GET for cloud) per source URI", body = SourceUrlsResponse),
        (status = 404, description = "Job not found"),
    )
)]
/// Sign GET URLs so the browser fetches the program's cloud sources directly
/// (no data through the server). Each cloud URI is signed with the creds of the
/// job connection whose base URL prefixes it; non-cloud (HTTP/public) URIs pass
/// through verbatim.
pub async fn resolve_source_urls(
    ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<SourceUrlsRequest>,
) -> Response {
    let Some(job) = state.db.get_job(id.as_str()).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(error_body("not_found", "Job not found")),
        )
            .into_response();
    };
    if let Some(resp) = forbid_non_producer(&job, &ctx.user_id) {
        return resp;
    }
    // (base URL, cloud account) of each connection — used to pick the creds for
    // a cloud source by longest-prefix match on its base URL.
    let mut conns: Vec<(String, Option<String>)> = Vec::new();
    for cid in &job.connection_ids {
        if let Some(c) = state.db.get_connection(cid).await {
            conns.push((c.url, c.cloud_account_id));
        }
    }

    let mut urls = HashMap::with_capacity(req.uris.len());
    for uri in &req.uris {
        if !crate::cloud::is_cloud_url(uri) {
            urls.insert(uri.clone(), uri.clone()); // public / HTTP — fetch directly
            continue;
        }
        let account = conns
            .iter()
            .filter(|(base, _)| uri.starts_with(base.as_str()))
            .max_by_key(|(base, _)| base.len())
            .and_then(|(_, acct)| acct.clone());
        let creds = match account {
            Some(acct) => state.db.build_storage_config(&[acct]).await,
            None => HashMap::new(),
        };
        let (store, path) = match crate::cloud::build_store(uri, &creds) {
            Ok(sp) => sp,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_body("store_error", e.to_string())),
                )
                    .into_response();
            }
        };
        match store.sign_url(Method::GET, &path, SIGNED_URL_EXPIRES).await {
            Ok(signed) => {
                urls.insert(uri.clone(), signed.to_string());
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_body("sign_error", e.to_string())),
                )
                    .into_response();
            }
        }
    }
    Json(SourceUrlsResponse { urls }).into_response()
}
