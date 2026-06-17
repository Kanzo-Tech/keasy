use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::AppState;
use crate::error::data_response;
use crate::jobs::models::{
    CompleteJobRequest, CreateJobRequest, Job, JobStatus, RunMode, UpdateJobRequest, now_iso8601,
};
use crate::middleware::tenant::{IsMember, Require};

use super::errors::{classify_error, JobApiError, JobRuntimeError};

#[utoipa::path(get, path = "/v1/jobs", tag = "Jobs",
    responses(
        (status = 200, description = "List of jobs", body = Vec<Job>),
    )
)]
pub async fn list_jobs(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, JobApiError> {
    let jobs = state.db.list_jobs().await;
    Ok(data_response(jobs))
}

#[utoipa::path(post, path = "/v1/jobs", tag = "Jobs",
    request_body = CreateJobRequest,
    responses(
        (status = 201, description = "Draft job created", body = Job),
        (status = 202, description = "Job submitted for execution", body = Job),
    )
)]
pub async fn create_job(
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    let id = uuid::Uuid::new_v4().to_string();

    if payload.draft {
        let job = Job {
            id: id.clone(),
            status: JobStatus::Draft,
            name: payload.name.or_else(|| Some(id[..8].to_string())),
            created_at: now_iso8601(),
            started_at: None,
            completed_at: None,
            error: None,
            mode: payload.mode.unwrap_or(RunMode::Integrated),
            connection_ids: payload.connection_ids.clone(),
            created_by: ctx.user_id.clone(),
            sink_connection_id: payload.sink_connection_id.clone(),
            script: Some(payload.script),
            manifest: None,
            catalog_manifest: None,
        };
        state.db.insert_job(&job).await
            .map_err(JobApiError::Internal)?;
        return Ok((StatusCode::CREATED, data_response(job)).into_response());
    }

    // Browser-driven execution: persist the program as `Pending` and let the
    // client run it on DataFusion-WASM — sources via signed GET, GraphAr output
    // via signed PUT, outcome via `PATCH /v1/jobs/{id}`. The server never runs
    // the mapping (no subprocess, no data through the host). The runner is still
    // linked but no longer spawned; its deletion is B6.
    let job = Job {
        id: id.clone(),
        status: JobStatus::Pending,
        name: payload.name.or_else(|| Some(id[..8].to_string())),
        created_at: now_iso8601(),
        started_at: None,
        completed_at: None,
        error: None,
        mode: payload.mode.unwrap_or(RunMode::Integrated),
        connection_ids: payload.connection_ids.clone(),
        created_by: ctx.user_id.clone(),
        sink_connection_id: payload.sink_connection_id.clone(),
        script: Some(payload.script),
        manifest: None,
        catalog_manifest: None,
    };

    state.db.insert_job(&job).await
        .map_err(JobApiError::Internal)?;

    Ok((StatusCode::ACCEPTED, data_response(job)).into_response())
}

#[utoipa::path(get, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job details", body = Job),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn get_job(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.get_job(id.as_str()).await {
        Some(job) => Ok(data_response(job).into_response()),
        None => Err(JobApiError::NotFound),
    }
}

#[utoipa::path(put, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = UpdateJobRequest,
    responses(
        (status = 200, description = "Job updated", body = Job),
        (status = 400, description = "Job is not a draft"),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn update_job(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.update_job(id.as_str(), |job| {
        if job.status != JobStatus::Draft {
            return;
        }
        if let Some(script) = payload.script {
            job.script = Some(script);
        }
        if let Some(name) = payload.name {
            job.name = Some(name);
        }
    }).await.map_err(JobApiError::Internal)? {
        Some(job) if job.status == JobStatus::Draft => Ok(data_response(job).into_response()),
        Some(_) => Err(JobApiError::NotDraft),
        None => Err(JobApiError::NotFound),
    }
}

#[utoipa::path(patch, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = CompleteJobRequest,
    responses(
        (status = 200, description = "Job status updated from the browser run", body = Job),
        (status = 404, description = "Job not found"),
    )
)]
/// Browser-driven completion: the client (`@fossil-lang/executor`) ran the
/// mapping, signed-PUT the output, and reports the outcome here. `Completed`
/// stores the executor's `RunStatus` (the discovery + DCAT views read it); the
/// server never touches the data — only the metadata.
pub async fn complete_job(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<CompleteJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    let now = now_iso8601();
    let CompleteJobRequest { status, mut manifest, catalog_manifest, error } = payload;

    // The output lives where the signed PUTs wrote it — `{dest_base}/{job_id}`,
    // where `dest_base` is the connection the member chose as the destination
    // (`sink_connection_id`), or the workspace substrate as fallback. keasy is
    // authoritative over the dest, so stamp `manifest.dest` server-side (the same
    // base `resolve_output_urls` signs) rather than trust the browser. Discovery
    // reads `manifest.dest` as the dataset base for signed GETs.
    // Creds the output was signed with — reused to register it in the catalog
    // (the same account that wrote the Parquet reads its footers). Captured here
    // because `status`/`manifest` move into the writer closure below.
    let mut output_creds: Option<std::collections::HashMap<String, String>> = None;
    if matches!(status, JobStatus::Completed)
        && let Some(job) = state.db.get_job(&id).await
        && let (Some(m), Some((base, creds))) = (manifest.as_mut(), state.db.job_output_target(&job).await)
    {
        m.dest = format!("{}/{}", base.trim_end_matches('/'), id);
        output_creds = Some(creds);
    }

    // Snapshot the stamped manifest for catalog registration before it moves.
    let to_register = manifest.clone();

    let updated = state
        .db
        .update_job(id.as_str(), move |job| {
            match &status {
                JobStatus::Completed => {
                    job.started_at.get_or_insert_with(|| now.clone());
                    job.completed_at = Some(now);
                    job.manifest = manifest;
                    job.catalog_manifest = catalog_manifest;
                    job.error = None;
                }
                JobStatus::Failed => {
                    job.started_at.get_or_insert_with(|| now.clone());
                    job.completed_at = Some(now);
                    job.error = Some(error.as_deref().map_or_else(
                        || JobRuntimeError::new("EXECUTION_ERROR", "execution failed"),
                        classify_error,
                    ));
                }
                JobStatus::Running => {
                    if job.started_at.is_none() {
                        job.started_at = Some(now);
                    }
                }
                _ => {}
            }
            job.status = status;
        })
        .await
        .map_err(JobApiError::Internal)?;

    // Register the output in the DuckLake catalog as one atomic snapshot —
    // FIRE-AND-FORGET. The data is already durable at the sink, so a slow or
    // failing catalog write must never delay (or fail) job completion. The
    // detached task does the remote footer reads off the request path; whatever
    // it misses, the reconciler (§11) picks up on its next pass.
    if let (Some(catalog), Some(dataset), Some(creds)) =
        (state.catalog.clone(), to_register, output_creds)
    {
        let job_id = id.clone();
        tokio::spawn(async move {
            match tokio::task::spawn_blocking(move || catalog.register(&job_id, &dataset, &creds)).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => tracing::warn!(error = %e, "catalog registration failed (reconciler will retry)"),
                Err(e) => tracing::warn!(error = %e, "catalog registration task panicked"),
            }
        });
    }

    match updated {
        Some(job) => Ok(data_response(job).into_response()),
        None => Err(JobApiError::NotFound),
    }
}

#[utoipa::path(delete, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 204, description = "Job deleted"),
        (status = 404, description = "Job not found"),
        (status = 409, description = "Job is still running"),
    )
)]
pub async fn delete_job(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    let job = state.db.get_job(id.as_str()).await
        .ok_or(JobApiError::NotFound)?;

    if matches!(job.status, JobStatus::Pending | JobStatus::Running) {
        return Err(JobApiError::StillRunning);
    }

    state.db.remove_job(id.as_str()).await
        .map_err(JobApiError::Internal)?;

    // Drop the job's dataset from the catalog so governance stops listing a ghost
    // — BYOS-safe (only catalog metadata, never the member's Parquet). Whatever
    // this misses, the reconciler's deregister pass cleans up.
    if let Some(catalog) = state.catalog.clone() {
        let job_id = id.clone();
        tokio::spawn(async move {
            if let Ok(Err(e)) = tokio::task::spawn_blocking(move || catalog.unregister(&job_id)).await {
                tracing::warn!(error = %e, "catalog unregister failed (reconciler will retry)");
            }
        });
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[utoipa::path(get, path = "/v1/jobs/{id}/dashboard-layout", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "Dashboard layout", body = serde_json::Value), (status = 204, description = "No layout saved"))
)]
pub async fn get_dashboard_layout(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(id.as_str()).await.is_none() {
        return Err(JobApiError::NotFound);
    }
    match state.db.get_dashboard_layout(&id).await {
        Some(layout) => Ok(data_response(layout).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

#[utoipa::path(put, path = "/v1/jobs/{id}/dashboard-layout", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = serde_json::Value,
    responses((status = 200, description = "Layout saved"))
)]
pub async fn save_dashboard_layout(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(id.as_str()).await.is_none() {
        return Err(JobApiError::NotFound);
    }
    state.db.set_dashboard_layout(&id, &body).await;
    Ok(StatusCode::OK.into_response())
}
