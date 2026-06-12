use std::collections::HashMap;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use http::Method;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::error_body;
use crate::jobs::fossil_runner::CloudSecret;
use crate::jobs::models::{Job, JobStatus};
use crate::middleware::tenant::{IsMember, IsOwner, Require};

/// Data sovereignty: only the job's producer (`created_by`) may read or run its
/// DATA — sources, output Parquet, the GraphAr manifest. The CATALOG (DCAT
/// metadata) stays open to every member: the owner discovers the space at the
/// metadata level, never the bytes (IDS/Solid model).
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
pub(crate) async fn require_output_ready(
    state: &AppState,
    job_id: &str,
) -> Result<(), Response> {
    let job = state
        .db
        .get_job(job_id)
        .await
        .ok_or_else(|| {
            (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response()
        })?;

    if job.status != JobStatus::Completed {
        return Err((StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response());
    }

    Ok(())
}

// ── Shared URL signing ──────────────────────────────────────────────────

const SIGNED_URL_EXPIRES: Duration = Duration::from_secs(300);

#[derive(Serialize, utoipa::ToSchema)]
struct ResolveResponse {
    files: HashMap<String, String>,
}

/// Sign the given dataset-relative paths under `base_url` for `method`. Shared
/// by the discover + catalog readers (`Method::GET`) and the browser output
/// uploader (`Method::PUT`) — each caller supplies its file list. The output
/// lives in the data space substrate, so it is signed with the substrate's creds.
async fn sign_manifest_urls(
    state: &AppState,
    method: Method,
    base_url: &str,
    files: &[String],
) -> Result<Response, Response> {
    let creds = state.db.substrate_storage_config().await;

    let (store, prefix) = crate::cloud::build_store(base_url, &creds)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("store_error", e.to_string()))).into_response())?;

    let all_files: Vec<String> = files.to_vec();

    let mut paths = Vec::with_capacity(all_files.len());
    for f in &all_files {
        let full = if prefix.as_ref().is_empty() { f.to_string() } else { format!("{prefix}/{f}") };
        let p = object_store::path::Path::parse(&full)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("path_error", e.to_string()))).into_response())?;
        paths.push(p);
    }

    let urls = store.sign_urls(method, &paths, SIGNED_URL_EXPIRES).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("sign_error", e.to_string()))).into_response())?;

    let files: HashMap<String, String> = all_files.into_iter()
        .zip(urls.into_iter().map(|u| u.to_string()))
        .collect();

    Ok(Json(ResolveResponse { files }).into_response())
}

// ── Browser output upload URLs (signed PUT) ─────────────────────────────────

#[derive(Deserialize, utoipa::ToSchema)]
pub struct OutputUrlsRequest {
    /// Dataset-relative output keys the browser executor produced
    /// (`vertex/Person.parquet`, `edge/<dir>/by_source.parquet`,
    /// `graph.graph.yml`, …).
    paths: Vec<String>,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/output/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = OutputUrlsRequest,
    responses(
        (status = 200, description = "Signed PUT URLs for the output keys", body = ResolveResponse),
        (status = 400, description = "No data space substrate configured"),
        (status = 404, description = "Job not found"),
    )
)]
/// Sign PUT URLs so the browser uploads the GraphAr output it just produced
/// directly to the data space substrate (no data through the server). The output
/// lives at `{substrate}/{created_by}/{job_id}/<key>` — the same dest the
/// completion `RunStatus` reports. Mirrors `resolve_discover_urls` but PUT.
pub async fn resolve_output_urls(
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<OutputUrlsRequest>,
) -> Response {
    let Some(job) = state.db.get_job(id.as_str()).await else {
        return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response();
    };
    if let Some(resp) = forbid_non_producer(&job, &ctx.user_id) {
        return resp;
    }
    let Some((_, base_url)) = state.db.substrate_config().await else {
        return (StatusCode::BAD_REQUEST, Json(error_body("no_substrate", "No data space substrate (output storage) is configured"))).into_response();
    };
    // Member prefix = the data-product owner; mirrors the dest stamped at
    // completion (`jobs::complete_job`). Both must match so the signed PUT
    // target and the recorded `manifest.dest` are the same.
    let dest = format!("{}/{}/{}", base_url.trim_end_matches('/'), job.created_by, id);

    match sign_manifest_urls(&state, Method::PUT, &dest, &req.paths).await {
        Ok(resp) | Err(resp) => resp,
    }
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
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let Some(job) = state.db.get_job(id.as_str()).await else {
        return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response();
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
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<SourceUrlsRequest>,
) -> Response {
    let Some(job) = state.db.get_job(id.as_str()).await else {
        return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response();
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
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("store_error", e.to_string()))).into_response(),
        };
        match store.sign_url(Method::GET, &path, SIGNED_URL_EXPIRES).await {
            Ok(signed) => { urls.insert(uri.clone(), signed.to_string()); }
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("sign_error", e.to_string()))).into_response(),
        }
    }
    Json(SourceUrlsResponse { urls }).into_response()
}

// ── Discovery parquet URLs ──────────────────────────────────────────────

#[utoipa::path(get, path = "/v1/jobs/{id}/discover/urls", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Signed URLs for direct Parquet access", body = ResolveResponse),
        (status = 404, description = "Job not found or no output"),
    )
)]
pub async fn resolve_discover_urls(
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let job = match state.db.get_job(id.as_str()).await {
        Some(j) => j,
        None => return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response(),
    };
    if let Some(resp) = forbid_non_producer(&job, &ctx.user_id) {
        return resp;
    }
    if job.status != JobStatus::Completed {
        return (StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response();
    }
    let Some(manifest) = &job.manifest else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_output", "Job has no RDF output"))).into_response();
    };
    // The dataset base URL is the manifest's `dest` (fossil's single description
    // of the output) — keasy doesn't store a duplicate.
    let base = &manifest.dest;

    let files: Vec<String> = manifest.vertices.iter().map(|v| v.file.clone())
        .chain(manifest.edges.iter().map(|e| e.by_source.clone()))
        .collect();

    match sign_manifest_urls(&state, Method::GET, base, &files).await {
        Ok(resp) => resp,
        Err(resp) => resp,
    }
}

// ── Discovery GraphAr manifest ──────────────────────────────────────────

#[derive(Serialize, utoipa::ToSchema)]
struct ManifestResponse {
    /// The GraphAr manifest YAMLs, keyed by dataset-relative path
    /// (`graph.graph.yml`, `vertex/Person.vertex.yml`, …). Fed verbatim into
    /// `@fossil-lang/graph`'s `createGraphClient({ manifestFiles })`; keasy
    /// treats them as opaque blobs — fossil owns the GraphAr layout.
    manifest_files: HashMap<String, String>,
}

#[utoipa::path(get, path = "/v1/jobs/{id}/discover/manifest", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "GraphAr manifest YAMLs, keyed by dataset-relative path", body = ManifestResponse),
        (status = 404, description = "Job not found or no output"),
    )
)]
pub async fn resolve_discover_manifest(
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let job = match state.db.get_job(id.as_str()).await {
        Some(j) => j,
        None => return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response(),
    };
    if let Some(resp) = forbid_non_producer(&job, &ctx.user_id) {
        return resp;
    }
    if job.status != JobStatus::Completed {
        return (StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response();
    }
    let Some(manifest) = &job.manifest else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_output", "Job has no RDF output"))).into_response();
    };
    let base = &manifest.dest;

    let creds = state.db.substrate_storage_config().await;

    match read_manifest_files(base, &creds).await {
        Ok(manifest_files) => Json(ManifestResponse { manifest_files }).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("manifest_error", e))).into_response(),
    }
}

/// List the GraphAr dataset prefix and return every manifest YAML's contents,
/// keyed by dataset-relative path. Layout-agnostic: keasy doesn't parse the
/// GraphAr structure — it serves the `.yml`/`.yaml` blobs and lets the
/// `fossil-graph` binding resolve them by relative path.
async fn read_manifest_files(
    base_url: &str,
    creds: &HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    use futures::StreamExt;

    let (store, prefix) = crate::cloud::build_store(base_url, creds).map_err(|e| e.to_string())?;
    let prefix_opt = if prefix.as_ref().is_empty() { None } else { Some(&prefix) };
    let strip = if prefix.as_ref().is_empty() { String::new() } else { format!("{prefix}/") };

    let entries = store.list(prefix_opt).collect::<Vec<_>>().await;

    let mut files = HashMap::new();
    for entry in entries {
        let meta = entry.map_err(|e| format!("Error listing manifest: {e}"))?;
        let full = meta.location.to_string();
        if !(full.ends_with(".yml") || full.ends_with(".yaml")) {
            continue;
        }
        let rel = full.strip_prefix(&strip).unwrap_or(&full).to_string();
        let result = store.get(&meta.location).await.map_err(|e| e.to_string())?;
        let bytes = result.bytes().await.map_err(|e| e.to_string())?;
        let text = String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())?;
        files.insert(rel, text);
    }

    Ok(files)
}

// ── Catalog parquet URLs ────────────────────────────────────────────────

#[utoipa::path(get, path = "/v1/jobs/{id}/catalog/urls", tag = "Catalog",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Signed URLs for catalog Parquet access", body = ResolveResponse),
        (status = 404, description = "Job not found or no catalog"),
    )
)]
pub async fn resolve_catalog_urls(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let job = match state.db.get_job(id.as_str()).await {
        Some(j) => j,
        None => return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response(),
    };
    if job.status != JobStatus::Completed {
        return (StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response();
    }
    let Some(manifest) = &job.catalog_manifest else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_catalog", "Job has no catalog output"))).into_response();
    };
    let base = &manifest.dest;

    let files: Vec<String> = manifest.vertices.iter().map(|v| v.file.clone())
        .chain(manifest.edges.iter().map(|e| e.by_source.clone()))
        .collect();

    match sign_manifest_urls(&state, Method::GET, base, &files).await {
        Ok(resp) => resp,
        Err(resp) => resp,
    }
}

// ── Catalog GraphAr manifest ────────────────────────────────────────────

#[utoipa::path(get, path = "/v1/jobs/{id}/catalog/manifest", tag = "Catalog",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "GraphAr manifest YAMLs for the catalog dataset", body = ManifestResponse),
        (status = 404, description = "Job not found or no catalog"),
    )
)]
pub async fn resolve_catalog_manifest(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let job = match state.db.get_job(id.as_str()).await {
        Some(j) => j,
        None => return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response(),
    };
    if job.status != JobStatus::Completed {
        return (StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response();
    }
    let Some(manifest) = &job.catalog_manifest else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_catalog", "Job has no catalog output"))).into_response();
    };
    let base = &manifest.dest;

    let creds = state.db.substrate_storage_config().await;

    match read_manifest_files(base, &creds).await {
        Ok(manifest_files) => Json(ManifestResponse { manifest_files }).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("manifest_error", e))).into_response(),
    }
}

// ── Owner-gated execute_sql (server-side via fossil-mcp) ─────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ExecuteSqlRequest {
    /// SQL to run against the GraphAr views (vertex/edge type names).
    pub sql: String,
    /// Max rows returned (the verb enforces an outer LIMIT). Default 10k.
    #[serde(default)]
    pub row_cap: Option<u32>,
    /// Wall-clock cap, milliseconds. Default 10s.
    #[serde(default)]
    pub timeout_ms: Option<u32>,
}

/// Project the owner storage account's DuckDB secret to `{ type, params }` JSON
/// for the fossil-mcp dataset. Secret values are exposed ONLY here, into the
/// JSON written to the MCP child's stdin pipe — never logged.
fn secret_to_json(cs: &CloudSecret) -> serde_json::Value {
    let params: serde_json::Map<String, serde_json::Value> = cs
        .params
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::Value::String(v.expose_secret().to_owned())))
        .collect();
    serde_json::json!({ "type": cs.secret_type, "params": params })
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/execute-sql", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = ExecuteSqlRequest,
    responses(
        (status = 200, description = "Verb result: { columns, rows, truncated }"),
        (status = 403, description = "Owner role required"),
        (status = 404, description = "Job not found or no output"),
    )
)]
pub async fn execute_discover_sql(
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ExecuteSqlRequest>,
) -> Response {
    let job = match state.db.get_job(id.as_str()).await {
        Some(j) => j,
        None => return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response(),
    };
    if job.status != JobStatus::Completed {
        return (StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response();
    }
    let Some(manifest) = &job.manifest else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_output", "Job has no RDF output"))).into_response();
    };
    let base = &manifest.dest;

    // The owner storage account backs the GraphAr output; its DuckDB secret
    // reads it over httpfs inside fossil-mcp.
    let secret = match state.db.substrate_config().await {
        Some((account_id, _)) => state
            .db
            .get_cloud_account(&account_id)
            .await
            .as_ref()
            .and_then(crate::jobs::run_creds::cloud_secret)
            .map(|cs| secret_to_json(&cs)),
        None => None,
    };

    let creds = state.db.substrate_storage_config().await;
    let manifest_files = match read_manifest_files(base, &creds).await {
        Ok(m) => m,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("manifest_error", e))).into_response();
        }
    };

    let dataset = serde_json::json!({
        "dest": base,
        "secret": secret,
        "manifest_files": manifest_files,
    });
    let mut params = serde_json::json!({ "sql": req.sql });
    if let Some(rc) = req.row_cap {
        params["row_cap"] = rc.into();
    }
    if let Some(t) = req.timeout_ms {
        params["timeout_ms"] = t.into();
    }
    let operation = serde_json::json!({ "verb": "execute_sql", "params": params });

    match super::mcp::dispatch_verb(dataset, operation).await {
        Ok(result) => Json(result).into_response(),
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("execute_sql_error", e))).into_response()
        }
    }
}
