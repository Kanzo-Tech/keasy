use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::AppState;
use crate::error::{AppError, data_response};
use crate::jobs::models::CreateJobRequest;
use crate::middleware::tenant::{IsParticipant, Require};

use super::models::UpdateJobRequest;
use super::service::JobService;

fn svc(state: &AppState) -> JobService {
    JobService::new(state.jobs.clone())
}

#[utoipa::path(get, path = "/v1/jobs", tag = "Jobs",
    responses(
        (status = 200, description = "List of jobs", body = Vec<super::models::Job>),
    )
)]
pub async fn list_jobs(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    data_response(svc(&state).list(&ctx.tenant()).await)
}

#[utoipa::path(post, path = "/v1/jobs", tag = "Jobs",
    request_body = CreateJobRequest,
    responses(
        (status = 201, description = "Draft job created", body = super::models::Job),
        (status = 202, description = "Job submitted for execution", body = super::models::Job),
    )
)]
pub async fn create_job(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> Result<impl IntoResponse, AppError> {
    if payload.draft {
        let job = svc(&state).create_draft(&ctx.tenant(), payload).await?;
        return Ok((StatusCode::CREATED, data_response(job)).into_response());
    }

    let dcat_enabled = payload.dcat_enabled.unwrap_or(false);

    let job = svc(&state).create_and_submit(&ctx.tenant(), &payload).await?;

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
        .map_err(AppError::Validation)?;

    use crate::executor::runner::SpawnParams;
    state.runner.spawn(SpawnParams {
        org_id: ctx.org_id.0.clone(),
        job_id: job.id.clone(),
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
        (status = 200, description = "Job details", body = super::models::Job),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn get_job(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let job = svc(&state).get(&ctx.resource(&id)).await?;
    Ok(data_response(job))
}

#[utoipa::path(put, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = UpdateJobRequest,
    responses(
        (status = 200, description = "Job updated", body = super::models::Job),
        (status = 400, description = "Job is not a draft"),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn update_job(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateJobRequest>,
) -> Result<impl IntoResponse, AppError> {
    let job = svc(&state).update(&ctx.resource(&id), payload).await?;
    Ok(data_response(job))
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
) -> Result<impl IntoResponse, AppError> {
    svc(&state).delete(&ctx.resource(&id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/v1/jobs/{id}/dashboard-layout", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "Dashboard layout", body = serde_json::Value), (status = 204, description = "No layout saved"))
)]
pub async fn get_dashboard_layout(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // Verify job exists via the repository trait
    svc(&state).get(&ctx.resource(&id)).await?;
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
) -> Result<impl IntoResponse, AppError> {
    svc(&state).get(&ctx.resource(&id)).await?;
    state.repos.set_dashboard_layout(&id, &body).await;
    Ok(StatusCode::OK)
}
