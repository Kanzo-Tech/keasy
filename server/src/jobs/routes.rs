use std::convert::Infallible;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    response::sse::{Event, KeepAlive, Sse},
};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use tracing::warn;

use crate::AppState;
use crate::error::data_response;
use crate::jobs::models::{
    CompleteJobRequest, CreateJobRequest, Job, JobStatus, RunMode, UpdateJobRequest, now_iso8601,
};
use super::runner::JobEvent;
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
    _ctx: Require<IsMember>,
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

    // The output lives where the signed PUTs wrote it — `{owner_base}/{job_id}`
    // (the same dest `resolve_output_urls` signs). keasy is authoritative over
    // it, so stamp `manifest.dest` server-side rather than trust the browser:
    // discovery reads `manifest.dest` as the dataset base for signed GETs.
    if matches!(status, JobStatus::Completed) {
        if let (Some(m), Some((_, base))) = (manifest.as_mut(), state.db.get_owner_catalog_config().await) {
            m.dest = format!("{}/{}", base.trim_end_matches('/'), id);
        }
    }

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

    match updated {
        Some(job) => Ok(data_response(job).into_response()),
        None => Err(JobApiError::NotFound),
    }
}

#[utoipa::path(get, path = "/v1/jobs/{id}/stream", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "SSE stream of job progress events", body = JobEvent, content_type = "text/event-stream"),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn stream_job(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, JobApiError> {
    let job = state.db.get_job(id.as_str()).await
        .ok_or(JobApiError::NotFound)?;

    fn is_terminal(status: &JobStatus) -> bool {
        matches!(status, JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled)
    }

    fn terminal_event(job: &Job) -> JobEvent {
        let (phase, error) = match job.status {
            JobStatus::Completed => ("complete", None),
            JobStatus::Failed => ("error", job.error.as_ref().map(|e| e.message.clone())),
            JobStatus::Cancelled => ("complete", None),
            _ => ("complete", None),
        };
        JobEvent { phase: phase.into(), index: 4, total: 5, error }
    }

    // Already terminal → single event + close
    if is_terminal(&job.status) {
        let evt = terminal_event(&job);
        let stream = futures::stream::once(async move {
            Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&evt).unwrap_or_else(|e| { warn!("SSE serialization failed: {e}"); "{}".to_string() })))
        });
        return Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response());
    }

    // Subscribe to broadcast channel
    let rx = match state.runner.subscribe(&id) {
        Some(rx) => rx,
        None => {
            // Channel gone — job may have finished between DB read and subscribe; refetch
            let job = state.db.get_job(id.as_str()).await
                .ok_or(JobApiError::NotFound)?;
            let evt = terminal_event(&job);
            let stream = futures::stream::once(async move {
                Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&evt).unwrap_or_else(|e| { warn!("SSE serialization failed: {e}"); "{}".to_string() })))
            });
            return Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response());
        }
    };

    let stream = BroadcastStream::new(rx)
        .filter_map(|r| r.ok())
        .map(|evt| Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&evt).unwrap_or_else(|e| { warn!("SSE serialization failed: {e}"); "{}".to_string() }))));

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
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
