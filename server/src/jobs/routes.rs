use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::AppState;
use crate::auth::role::Member;
use keasy_api::ErrorBody;
use keasy_api::connections::Direction;
use keasy_api::jobs::{
    CompleteJobRequest, CreateJobRequest, Job, JobStatus, PublishRelationsRequest, UpdateJobRequest,
};

use super::errors::JobApiError;
use super::{now_iso8601, requested};

/// The job, if it exists and `member` created it. Anyone else's job is not
/// found: a job is its creator's alone.
pub(crate) async fn owned_job(
    state: &AppState,
    member: &Member,
    id: &str,
) -> Result<Job, JobApiError> {
    state
        .db
        .get_job(id)
        .await?
        .filter(|job| job.created_by == member.user_id)
        .ok_or(JobApiError::NotFound)
}

#[utoipa::path(get, path = "/v1/jobs", tag = "Jobs",
    responses(
        (status = 200, description = "The caller's jobs", body = Vec<Job>),
    )
)]
pub async fn list_jobs(
    member: Member,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, JobApiError> {
    Ok(Json(state.db.list_jobs_of(&member.user_id).await?))
}

#[utoipa::path(post, path = "/v1/jobs", tag = "Jobs",
    request_body = CreateJobRequest,
    responses(
        (status = 201, description = "Draft job created", body = Job),
        (status = 202, description = "Job submitted for execution", body = Job),
        (status = 400, description = "The destination is not a sink", body = ErrorBody),
    )
)]
pub async fn create_job(
    member: Member,
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    let is_sink = state
        .db
        .get_connection(&payload.sink_connection_id)
        .await?
        .is_some_and(|c| c.direction == Direction::Sink);
    if !is_sink {
        return Err(JobApiError::InvalidDestination);
    }

    // A `Pending` job is run by the browser: sources by signed GET, output by
    // signed PUT, outcome by `PATCH /v1/jobs/{id}`.
    let (status, code) = if payload.draft {
        (JobStatus::Draft, StatusCode::CREATED)
    } else {
        (JobStatus::Pending, StatusCode::ACCEPTED)
    };
    let job = requested(status, payload, member.user_id);
    state.db.insert_job(&job).await?;

    Ok((code, Json(job)).into_response())
}

#[utoipa::path(get, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job details", body = Job),
        (status = 404, description = "Job not found", body = ErrorBody),
    )
)]
pub async fn get_job(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    Ok(Json(owned_job(&state, &member, &id).await?))
}

#[utoipa::path(put, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = UpdateJobRequest,
    responses(
        (status = 200, description = "Job updated", body = Job),
        (status = 400, description = "Job is not a draft", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
    )
)]
pub async fn update_job(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    if owned_job(&state, &member, &id).await?.status != JobStatus::Draft {
        return Err(JobApiError::NotDraft);
    }
    state
        .db
        .update_job(&id, |job| {
            if let Some(script) = payload.script {
                job.script = Some(script);
            }
            if let Some(name) = payload.name {
                job.name = Some(name);
            }
        })
        .await?
        .map(Json)
        .ok_or(JobApiError::NotFound)
}

#[utoipa::path(patch, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = CompleteJobRequest,
    responses(
        (status = 200, description = "Job status updated from the browser run", body = Job),
        (status = 404, description = "Job not found", body = ErrorBody),
    )
)]
/// The browser ran the mapping and uploaded the output; this records the
/// outcome. `Completed` stores the run report verbatim, unread.
pub async fn complete_job(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<CompleteJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    owned_job(&state, &member, &id).await?;
    let now = now_iso8601();
    let CompleteJobRequest {
        status,
        manifest,
        error,
    } = payload;

    state
        .db
        .update_job(&id, move |job| {
            match &status {
                JobStatus::Completed => {
                    job.started_at.get_or_insert_with(|| now.clone());
                    job.completed_at = Some(now);
                    job.manifest = manifest;
                    job.error = None;
                }
                JobStatus::Failed => {
                    job.started_at.get_or_insert_with(|| now.clone());
                    job.completed_at = Some(now);
                    job.error = Some(error.unwrap_or_else(|| "execution failed".into()));
                }
                JobStatus::Running => {
                    job.started_at.get_or_insert(now);
                }
                _ => {}
            }
            job.status = status;
        })
        .await?
        .map(Json)
        .ok_or(JobApiError::NotFound)
}

#[utoipa::path(put, path = "/v1/jobs/{id}/relations", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = PublishRelationsRequest,
    responses(
        (status = 200, description = "Relations stored", body = Job),
        (status = 400, description = "A file path outside the dataset", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
    )
)]
/// What the corpus reader found: the relations a finished job's output holds,
/// their names and the files that carry them, as `@fossil-lang/corpus`
/// enumerated them in the browser.
///
/// It is a second call and not a field of the completion because naming a
/// relation is an answer only a reader holding the manifests can give, and the
/// run report is not that reader. keasy stores the answer verbatim; it is what
/// the owner's datasets view lists.
pub async fn publish_relations(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PublishRelationsRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    owned_job(&state, &member, &id).await?;

    let relations = payload.relations;
    for file in relations.iter().flat_map(|r| &r.files) {
        crate::cloud::relative_path(file).map_err(JobApiError::InvalidFormat)?;
    }
    state
        .db
        .update_job(&id, move |job| job.relations = relations)
        .await?
        .map(Json)
        .ok_or(JobApiError::NotFound)
}

#[utoipa::path(delete, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 204, description = "Job deleted"),
        (status = 404, description = "Job not found", body = ErrorBody),
        (status = 409, description = "Job is still running", body = ErrorBody),
    )
)]
pub async fn delete_job(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    let job = owned_job(&state, &member, &id).await?;
    if matches!(job.status, JobStatus::Pending | JobStatus::Running) {
        return Err(JobApiError::StillRunning);
    }

    state.db.remove_job(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_jobs, create_job))
        .routes(routes!(get_job, update_job, complete_job, delete_job))
        .routes(routes!(publish_relations))
}
