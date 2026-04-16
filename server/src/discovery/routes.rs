use std::collections::HashMap;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use http::Method;
use object_store::path::Path as ObjectPath;
use serde::Serialize;

use crate::graph::manifest::DataManifest;
use crate::AppState;
use crate::error::error_body;
use crate::jobs::models::{Job, JobStatus};
use crate::middleware::tenant::{IsParticipant, Require, TenantContext};

// ── Helpers ─────────────────────────────────────────────────────────────

/// Reference TTL for browser-facing presigned URLs. The DuckDB-WASM docs
/// suggest 15min–1h; 15min limits leakage and the frontend can re-fetch
/// `/discover/urls` cheaply if a session outlives it.
const SIGNED_URL_EXPIRES: Duration = Duration::from_secs(15 * 60);

#[derive(Serialize, utoipa::ToSchema)]
struct ResolveResponse {
    files: HashMap<String, String>,
}

/// Fetch a completed job or return an error response.
async fn load_completed_job(
    state: &AppState,
    ctx: &TenantContext,
    job_id: &str,
) -> Result<Job, Response> {
    let job = state.repos.get_job(&ctx.resource(job_id)).await
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response())?;
    if job.status != JobStatus::Completed {
        return Err((StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response());
    }
    Ok(job)
}

/// Sign parquet URLs for a manifest.
///
/// Reference pattern (HuggingFace Datasets, GitHub LFS, Kaggle, official
/// DuckDB-WASM docs): backend presigns short-lived URLs scoped to the
/// authenticated user, browser uses them directly in `read_parquet(...)`
/// via httpfs. Bucket needs CORS configured once for the keasy origin
/// (see `infra/README.md`).
async fn sign_manifest_urls(
    state: &AppState,
    ctx: &TenantContext,
    base_url: &str,
    manifest: &DataManifest,
    connector_ids: &[String],
) -> Result<Response, Response> {
    let resolver = state
        .repos
        .build_path_resolver(
            &ctx.tenant(),
            connector_ids,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("resolver_error", e)),
            )
                .into_response()
        })?;

    // Find the connector entry whose `base_url` is a prefix of the job's
    // output `base_url`. The "extra" suffix between the two is the
    // path-within-store prefix that all manifest file paths sit under.
    let (entry, sub_prefix) = resolver
        .entries()
        .iter()
        .find_map(|e| {
            base_url
                .strip_prefix(&e.base_url)
                .map(|rest| (e, rest.trim_start_matches('/').to_string()))
        })
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body(
                    "no_connector_match",
                    format!("no authorized connector matches output URL: {base_url}"),
                )),
            )
                .into_response()
        })?;

    let all_files: Vec<String> = manifest
        .types
        .iter()
        .map(|t| t.vertex_file.clone())
        .chain(manifest.edges.iter().map(|e| e.by_source.clone()))
        .collect();

    let mut paths = Vec::with_capacity(all_files.len());
    for f in &all_files {
        let full = if sub_prefix.is_empty() {
            f.to_string()
        } else {
            format!("{sub_prefix}/{f}")
        };
        let p = ObjectPath::parse(&full).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("path_error", e.to_string())),
            )
                .into_response()
        })?;
        paths.push(p);
    }

    // Sign each path via the connector's `Arc<dyn CloudStore>`. `signed_url`
    // comes from `object_store::signer::Signer`, which `CloudStore` implies
    // by trait bound.
    let mut urls = Vec::with_capacity(paths.len());
    for path in &paths {
        let url = entry
            .store
            .signed_url(Method::GET, path, SIGNED_URL_EXPIRES)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_body("sign_error", e.to_string())),
                )
                    .into_response()
            })?;
        urls.push(url);
    }

    let files: HashMap<String, String> = all_files
        .into_iter()
        .zip(urls.into_iter().map(|u| u.to_string()))
        .collect();

    Ok(Json(ResolveResponse { files }).into_response())
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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let job = match load_completed_job(&state, &ctx, &id).await {
        Ok(j) => j,
        Err(resp) => return resp,
    };
    let Some(base) = &job.rdf_base else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_output", "Job has no RDF output"))).into_response();
    };
    let Some(manifest) = &job.manifest else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_manifest", "Job has no data manifest"))).into_response();
    };

    match sign_manifest_urls(&state, &ctx, base, manifest, &job.connector_ids).await {
        Ok(resp) => resp,
        Err(resp) => resp,
    }
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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let job = match load_completed_job(&state, &ctx, &id).await {
        Ok(j) => j,
        Err(resp) => return resp,
    };
    let Some(base) = &job.catalog_base else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_catalog", "Job has no catalog output"))).into_response();
    };
    let Some(manifest) = &job.catalog_manifest else {
        return (StatusCode::NOT_FOUND, Json(error_body("no_catalog_manifest", "Job has no catalog manifest"))).into_response();
    };

    match sign_manifest_urls(&state, &ctx, base, manifest, &job.connector_ids).await {
        Ok(resp) => resp,
        Err(resp) => resp,
    }
}
