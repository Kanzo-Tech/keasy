use std::collections::HashMap;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use http::Method;
use serde::Serialize;

use crate::graph::manifest::DataManifest;
use crate::AppState;
use crate::error::error_body;
use crate::jobs::models::{Job, JobStatus};
use crate::middleware::tenant::{IsParticipant, Require, TenantContext};

// ── Helpers ─────────────────────────────────────────────────────────────

const SIGNED_URL_EXPIRES: Duration = Duration::from_secs(300);

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
async fn sign_manifest_urls(
    state: &AppState,
    ctx: &TenantContext,
    base_url: &str,
    manifest: &DataManifest,
    connector_ids: &[String],
) -> Result<Response, Response> {
    let (store, prefix) = state.repos.build_signing_store_for_job(
        &state.connector_registry, &ctx.tenant(), connector_ids, base_url
    ).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("store_error", e))).into_response())?;

    let all_files: Vec<String> = manifest.types.iter().map(|t| t.vertex_file.clone())
        .chain(manifest.edges.iter().map(|e| e.by_source.clone()))
        .collect();

    let mut paths = Vec::with_capacity(all_files.len());
    for f in &all_files {
        let full = if prefix.as_ref().is_empty() { f.to_string() } else { format!("{prefix}/{f}") };
        let p = object_store::path::Path::parse(&full)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("path_error", e.to_string()))).into_response())?;
        paths.push(p);
    }

    let urls = store.sign_urls(Method::GET, &paths, SIGNED_URL_EXPIRES).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("sign_error", e.to_string()))).into_response())?;

    let files: HashMap<String, String> = all_files.into_iter()
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
