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
use crate::jobs::models::JobStatus;
use crate::middleware::tenant::{IsMember, IsOwner, Require};

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
/// lives in the owner sink, so it is signed with the sink's creds.
async fn sign_manifest_urls(
    state: &AppState,
    method: Method,
    base_url: &str,
    files: &[String],
) -> Result<Response, Response> {
    let creds = state.db.owner_output_storage_config().await;

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
        (status = 400, description = "No owner output storage configured"),
        (status = 404, description = "Job not found"),
    )
)]
/// Sign PUT URLs so the browser uploads the GraphAr output it just produced
/// directly to owner storage (no data through the server). The output lives at
/// `{owner_base}/{job_id}/<key>` — the same dest the completion `RunStatus`
/// reports. Mirrors `resolve_discover_urls` but signs `PUT` for upload.
pub async fn resolve_output_urls(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<OutputUrlsRequest>,
) -> Response {
    if state.db.get_job(id.as_str()).await.is_none() {
        return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response();
    }
    let Some((_, base_url)) = state.db.get_owner_catalog_config().await else {
        return (StatusCode::BAD_REQUEST, Json(error_body("no_owner_storage", "No owner output storage is configured"))).into_response();
    };
    let dest = format!("{}/{}", base_url.trim_end_matches('/'), id);

    match sign_manifest_urls(&state, Method::PUT, &dest, &req.paths).await {
        Ok(resp) | Err(resp) => resp,
    }
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
    let Some(manifest) = &job.manifest else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_output", "Job has no RDF output"))).into_response();
    };
    let base = &manifest.dest;

    let creds = state.db.owner_output_storage_config().await;

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

    let creds = state.db.owner_output_storage_config().await;

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
    let secret = match state.db.get_owner_catalog_config().await {
        Some((account_id, _)) => state
            .db
            .get_cloud_account(&account_id)
            .await
            .as_ref()
            .and_then(crate::jobs::run_creds::cloud_secret)
            .map(|cs| secret_to_json(&cs)),
        None => None,
    };

    let creds = state.db.owner_output_storage_config().await;
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
