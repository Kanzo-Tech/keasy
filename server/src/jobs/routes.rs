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
use crate::jobs::models::{CreateJobRequest, Job, JobStatus, RunMode, UpdateJobRequest, now_iso8601};
use super::runner::JobEvent;
use crate::middleware::tenant::{IsMember, Require};

use super::errors::JobApiError;

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

    let dcat_enabled = payload.dcat_enabled.unwrap_or(false);

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
        script: None,
        manifest: None,
        catalog_manifest: None,
    };

    state.db.insert_job(&job).await
        .map_err(JobApiError::Internal)?;

    let org_settings = if dcat_enabled {
        state.db.get_workspace_identity().await.map(|identity| {
            crate::settings::org::OrgSettings {
                publisher_name: identity.legal_name,
                ..Default::default()
            }
        })
    } else {
        None
    };

    // Owner cloud storage backs both the job's GraphAr output (always, when
    // configured) and — for dcat jobs — the DCAT-AP catalog. Fetch once.
    let owner_storage = state.db.get_owner_catalog_config().await;

    let output_dest = owner_storage
        .as_ref()
        .map(|(_, base_url)| format!("{}/{}", base_url.trim_end_matches('/'), id));

    let run_creds = crate::jobs::run_creds::build_run_creds(
        &state.db,
        &payload.connection_ids,
        owner_storage.as_ref().map(|(account, _)| account.clone()),
    )
    .await;

    // The catalog is written to owner storage via the `fossil catalog`
    // subprocess (cloud secret reused from the run's dest). keasy only supplies
    // the base URL; cloud auth rides the subprocess stdin, not a host resolver.
    let catalog_dest = if dcat_enabled {
        owner_storage
            .as_ref()
            .map(|(_, base_url)| base_url.clone())
    } else {
        None
    };

    use crate::jobs::runner::SpawnParams;
    state.runner.spawn(SpawnParams {
        job_id: id,
        script: payload.script,
        org_settings,
        dcat_enabled,
        output_dest,
        run_creds,
        catalog_dest,
    });

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
