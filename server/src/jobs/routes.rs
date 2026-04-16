use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::AppState;
use crate::error::data_response;
use crate::jobs::models::{CreateJobRequest, Job, JobStatus, RunMode, UpdateJobRequest, now_iso8601};
use crate::middleware::tenant::{IsParticipant, Require};

use super::errors::JobApiError;

#[utoipa::path(get, path = "/v1/jobs", tag = "Jobs",
    responses(
        (status = 200, description = "List of jobs", body = Vec<Job>),
    )
)]
pub async fn list_jobs(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, JobApiError> {
    let jobs = state.repos.list_jobs(&ctx.tenant()).await;
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
            connector_ids: payload.connector_ids.clone(),
            script: Some(payload.script),
            rdf_base: None,
            manifest: None,
        };
        state.repos.insert_job(&ctx.tenant(), &job).await
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
        pipeline: payload.pipeline.unwrap_or_default(),
        dcat_input: None,
        connector_ids: payload.connector_ids.clone(),
        script: None,
        rdf_base: None,
        manifest: None,
    };

    state.repos.insert_job(&ctx.tenant(), &job).await
        .map_err(JobApiError::Internal)?;

    let org_settings = if dcat_enabled {
        state.repos.get_organization(&ctx.org_id.0).await.map(|org| {
            crate::settings::org::OrgSettings {
                publisher_name: org.legal_name,
                ..Default::default()
            }
        })
    } else {
        None
    };

    let path_resolver = state
        .repos
        .build_path_resolver(
            &ctx.tenant(),
            &payload.connector_ids,
        )
        .await
        .map_err(JobApiError::InvalidFormat)?;

    use crate::executor::runner::SpawnParams;
    state.runner.spawn(SpawnParams {
        org_id: ctx.org_id.0.clone(),
        job_id: id,
        script: payload.script,
        org_settings,
        dcat_enabled,
        fossil_registry: state.fossil_registry.clone(),
        path_resolver,
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
    match state.repos.get_job(&ctx.resource(&id)).await {
        Some(job) => Ok(data_response(job).into_response()),
        None => {
            tracing::debug!(job_id = %id, org_id = %ctx.org_id.0, "job not found for tenant");
            Err(JobApiError::NotFound)
        }
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
    match state.repos.update_job(&ctx.resource(&id), |job| {
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
    let job = state.repos.get_job(&ctx.resource(&id)).await
        .ok_or(JobApiError::NotFound)?;

    if matches!(job.status, JobStatus::Pending | JobStatus::Running) {
        return Err(JobApiError::StillRunning);
    }

    state.repos.remove_job(&ctx.resource(&id)).await
        .map_err(JobApiError::Internal)?;

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[utoipa::path(get, path = "/v1/jobs/{id}/dashboard-layout", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "Dashboard layout", body = serde_json::Value), (status = 204, description = "No layout saved"))
)]
pub async fn get_dashboard_layout(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.repos.get_job(&ctx.resource(&id)).await.is_none() {
        return Err(JobApiError::NotFound);
    }
    match state.repos.get_dashboard_layout(&id).await {
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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.repos.get_job(&ctx.resource(&id)).await.is_none() {
        return Err(JobApiError::NotFound);
    }
    state.repos.set_dashboard_layout(&id, &body).await;
    Ok(StatusCode::OK.into_response())
}
