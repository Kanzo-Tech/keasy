use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::AppState;
use crate::auth::role::Member;
use crate::connections::models::Direction;
use crate::error::data_response;
use crate::jobs::models::{
    CompleteJobRequest, CreateJobRequest, Job, JobStatus, PublishRelationsRequest,
    UpdateJobRequest, now_iso8601,
};

use super::errors::{JobApiError, JobRuntimeError, classify_error};

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
        .await
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
    super::bootstrap::claim_declared_draft(&state.db, &member.user_id).await;
    Ok(data_response(state.db.list_jobs_of(&member.user_id).await))
}

#[utoipa::path(post, path = "/v1/jobs", tag = "Jobs",
    request_body = CreateJobRequest,
    responses(
        (status = 201, description = "Draft job created", body = Job),
        (status = 202, description = "Job submitted for execution", body = Job),
        (status = 400, description = "The destination is not a sink"),
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
        .await
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
    let job = Job::requested(status, payload, member.user_id);
    state
        .db
        .insert_job(&job)
        .await
        .map_err(JobApiError::Internal)?;

    Ok((code, data_response(job)).into_response())
}

#[utoipa::path(get, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job details", body = Job),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn get_job(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    Ok(data_response(owned_job(&state, &member, &id).await?))
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
        .await
        .map_err(JobApiError::Internal)?
        .map(data_response)
        .ok_or(JobApiError::NotFound)
}

#[utoipa::path(patch, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = CompleteJobRequest,
    responses(
        (status = 200, description = "Job status updated from the browser run", body = Job),
        (status = 404, description = "Job not found"),
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
                    job.error = Some(error.as_deref().map_or_else(
                        || JobRuntimeError::new("EXECUTION_ERROR", "execution failed"),
                        classify_error,
                    ));
                }
                JobStatus::Running => {
                    job.started_at.get_or_insert(now);
                }
                _ => {}
            }
            job.status = status;
        })
        .await
        .map_err(JobApiError::Internal)?
        .map(data_response)
        .ok_or(JobApiError::NotFound)
}

#[utoipa::path(put, path = "/v1/jobs/{id}/relations", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = PublishRelationsRequest,
    responses(
        (status = 200, description = "Relations stored and the dataset registered", body = Job),
        (status = 400, description = "A file path outside the dataset"),
        (status = 404, description = "Job not found"),
    )
)]
/// What the corpus reader found: the relations a finished job's output holds,
/// their names and the files that carry them, as `@fossil-lang/corpus`
/// enumerated them in the browser.
///
/// It is a second call and not a field of the completion because naming a
/// relation is an answer only a reader holding the manifests can give, and the
/// run report is not that reader. keasy stores the answer and registers the
/// dataset in the DuckLake catalog by reference — one atomic snapshot,
/// idempotent, composing nothing: every name and every path in that SQL came
/// from this payload.
pub async fn publish_relations(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PublishRelationsRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    let job = owned_job(&state, &member, &id).await?;

    let relations = payload.relations;
    for file in relations.iter().flat_map(|r| &r.files) {
        crate::cloud::relative_path(file).map_err(JobApiError::InvalidFormat)?;
    }
    let for_catalog = relations.clone();
    let updated = state
        .db
        .update_job(&id, move |job| job.relations = relations)
        .await
        .map_err(JobApiError::Internal)?;

    // Fire-and-forget: the data is already durable at the sink, so a slow or
    // failing catalog write must not delay or fail this call. Whatever it
    // misses, the reconciler picks up from the relations just stored.
    if !for_catalog.is_empty()
        && let (Some(catalog), Some((base, creds))) = (
            state.catalog.clone(),
            state.db.job_output_target(&job).await,
        )
    {
        let dest = crate::jobs::dataset_dest(&base, &id);
        let job_id = id.clone();
        tokio::spawn(async move {
            match tokio::task::spawn_blocking(move || {
                catalog.register(&job_id, &dest, &for_catalog, &creds)
            })
            .await
            {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, "catalog registration failed (reconciler will retry)")
                }
                Err(e) => tracing::warn!(error = %e, "catalog registration task panicked"),
            }
        });
    }

    updated.map(data_response).ok_or(JobApiError::NotFound)
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
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    let job = owned_job(&state, &member, &id).await?;
    if matches!(job.status, JobStatus::Pending | JobStatus::Running) {
        return Err(JobApiError::StillRunning);
    }

    state
        .db
        .remove_job(&id)
        .await
        .map_err(JobApiError::Internal)?;

    // Only the catalog's metadata goes; the Parquet at the sink is the member's.
    // Whatever this misses, the reconciler's deregister pass cleans up.
    if let Some(catalog) = state.catalog.clone() {
        tokio::spawn(async move {
            if let Ok(Err(e)) = tokio::task::spawn_blocking(move || catalog.unregister(&id)).await {
                tracing::warn!(error = %e, "catalog unregister failed (reconciler will retry)");
            }
        });
    }

    Ok(StatusCode::NO_CONTENT)
}
