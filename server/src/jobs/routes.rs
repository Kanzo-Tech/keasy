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

use crate::AppState;
use crate::error::data_response;
use crate::jobs::models::{CreateJobRequest, Job, JobStatus, RunMode, UpdateJobRequest, now_iso8601};
use super::rewrite;
use super::runner::JobEvent;
use crate::middleware::tenant::{IsParticipant, Require};

use super::errors::JobApiError;

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct CatalogResponse {
    pub catalog: String,
}

#[utoipa::path(get, path = "/v1/jobs", tag = "Jobs",
    responses(
        (status = 200, description = "List of jobs", body = Vec<Job>),
    )
)]
pub async fn list_jobs(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, JobApiError> {
    let jobs = state.db.list_jobs(&ctx.as_ctx()).await;
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
    ctx: Require<IsParticipant>,
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
            pipeline: payload.pipeline.unwrap_or_default(),
            dcat_input: None,
            connection_ids: payload.connection_ids.clone(),
            script: Some(payload.script),
            fragment_base: None,
        };
        state.db.insert_job(&ctx.as_ctx(), &job).await
            .map_err(JobApiError::Internal)?;
        return Ok((StatusCode::CREATED, data_response(job)).into_response());
    }

    let dcat_enabled = payload.dcat_enabled.unwrap_or(false);

    let resolved = rewrite::resolve(&payload.script, &ctx.org_id.0, &state.db).await
        .map_err(|e| JobApiError::RewriteFailed(e.message))?;

    let job = Job {
        id: id.clone(),
        status: JobStatus::Pending,
        name: payload.name.or_else(|| Some(id[..8].to_string())),
        created_at: now_iso8601(),
        started_at: None,
        completed_at: None,
        error: None,
        mode: payload.mode.unwrap_or(RunMode::Integrated),
        pipeline: payload.pipeline.unwrap_or_default(),
        dcat_input: None,
        connection_ids: payload.connection_ids.clone(),
        script: None,
        fragment_base: None,
    };

    state.db.insert_job(&ctx.as_ctx(), &job).await
        .map_err(JobApiError::Internal)?;

    let org_settings = if dcat_enabled {
        state.db.get_organization(&ctx.org_id.0).await.map(|org| {
            crate::settings::org::OrgSettings {
                publisher_name: org.legal_name,
                ..Default::default()
            }
        })
    } else {
        None
    };

    use crate::jobs::runner::SpawnParams;
    state.runner.spawn(SpawnParams {
        org_id: ctx.org_id.0.clone(),
        job_id: id,
        script: resolved.script,
        storage: resolved.storage,
        org_settings,
        dcat_enabled,
        catalog_store: state.catalog_store.clone(),
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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.get_job(&ctx.scoped(id.as_str())).await {
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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.update_job(&ctx.scoped(id.as_str()), |job| {
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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, JobApiError> {
    let job = state.db.get_job(&ctx.scoped(id.as_str())).await
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
            Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&evt).unwrap()))
        });
        return Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response());
    }

    // Subscribe to broadcast channel
    let rx = match state.runner.subscribe(&id) {
        Some(rx) => rx,
        None => {
            // Channel gone — job may have finished between DB read and subscribe; refetch
            let job = state.db.get_job(&ctx.scoped(id.as_str())).await
                .ok_or(JobApiError::NotFound)?;
            let evt = terminal_event(&job);
            let stream = futures::stream::once(async move {
                Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&evt).unwrap()))
            });
            return Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response());
        }
    };

    let stream = BroadcastStream::new(rx)
        .filter_map(|r| r.ok())
        .map(|evt| Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&evt).unwrap())));

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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    let job = state.db.get_job(&ctx.scoped(id.as_str())).await
        .ok_or(JobApiError::NotFound)?;

    if matches!(job.status, JobStatus::Pending | JobStatus::Running) {
        return Err(JobApiError::StillRunning);
    }

    // Drop the job's catalog from all stores (best-effort)
    state.catalog_store.remove(&id).await;

    state.db.remove_job(&ctx.scoped(id.as_str())).await
        .map_err(JobApiError::Internal)?;

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[utoipa::path(get, path = "/v1/jobs/{id}/catalog", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "DCAT catalog (N-Triples)", body = CatalogResponse),
        (status = 404, description = "Job or catalog not found"),
    )
)]
pub async fn get_job_catalog(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    // Verify job exists
    state.db.get_job(&ctx.scoped(id.as_str())).await
        .ok_or(JobApiError::NotFound)?;

    match state.catalog_store.get_raw(&id).await {
        Some(catalog) if !catalog.trim().is_empty() => {
            Ok(data_response(CatalogResponse { catalog }).into_response())
        }
        _ => Err(JobApiError::NoCatalog),
    }
}

#[utoipa::path(get, path = "/v1/jobs/{id}/graph", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job knowledge graph", body = crate::graph::convert::GraphData),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn get_job_graph(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    state.db.get_job(&ctx.scoped(id.as_str())).await
        .ok_or(JobApiError::NotFound)?;

    match state.catalog_store.get_dataset(&id).await {
        Some(ds) => Ok(data_response(crate::graph::dataset::get_graph(&ds)).into_response()),
        None => Ok(data_response(crate::graph::convert::GraphData {
            nodes: vec![],
            links: vec![],
        }).into_response()),
    }
}

#[utoipa::path(get, path = "/v1/jobs/{id}/dashboard-layout", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "Dashboard layout"), (status = 204, description = "No layout saved"))
)]
pub async fn get_dashboard_layout(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(&ctx.scoped(id.as_str())).await.is_none() {
        return Err(JobApiError::NotFound);
    }
    match state.db.get_dashboard_layout(&id).await {
        Some(layout) => Ok(data_response(layout).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

#[utoipa::path(put, path = "/v1/jobs/{id}/dashboard-layout", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "Layout saved"))
)]
pub async fn save_dashboard_layout(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(&ctx.scoped(id.as_str())).await.is_none() {
        return Err(JobApiError::NotFound);
    }
    state.db.set_dashboard_layout(&id, &body).await;
    Ok(StatusCode::OK.into_response())
}
