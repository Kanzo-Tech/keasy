use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::AppState;
use crate::error::data_response;
use crate::jobs::models::{
    CompleteJobRequest, CreateJobRequest, Job, JobStatus, PublishRelationsRequest,
    UpdateJobRequest, now_iso8601,
};
use crate::middleware::tenant::{IsDataPlane, Require};

use super::errors::{JobApiError, JobRuntimeError, classify_error};

#[utoipa::path(get, path = "/v1/jobs", tag = "Jobs",
    responses(
        (status = 200, description = "List of jobs", body = Vec<Job>),
    )
)]
pub async fn list_jobs(
    _ctx: Require<IsDataPlane>,
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
    ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    // Browser-driven execution: a `Pending` job is persisted and the client runs
    // it on DataFusion-WASM — sources via signed GET, GraphAr output via signed
    // PUT, outcome via `PATCH /v1/jobs/{id}`. The server never runs the mapping.
    let (status, code) = if payload.draft {
        (JobStatus::Draft, StatusCode::CREATED)
    } else {
        (JobStatus::Pending, StatusCode::ACCEPTED)
    };
    let job = Job::requested(status, payload, ctx.user_id.clone());
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
    _ctx: Require<IsDataPlane>,
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
    _ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    match state
        .db
        .update_job(id.as_str(), |job| {
            if job.status != JobStatus::Draft {
                return;
            }
            if let Some(script) = payload.script {
                job.script = Some(script);
            }
            if let Some(name) = payload.name {
                job.name = Some(name);
            }
        })
        .await
        .map_err(JobApiError::Internal)?
    {
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
/// stores the run report VERBATIM — keasy neither reads nor re-types it; the
/// server never touches the data, only the metadata.
pub async fn complete_job(
    _ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<CompleteJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    let now = now_iso8601();
    let CompleteJobRequest {
        status,
        manifest,
        error,
    } = payload;

    let updated = state
        .db
        .update_job(id.as_str(), move |job| {
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

#[utoipa::path(put, path = "/v1/jobs/{id}/relations", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = PublishRelationsRequest,
    responses(
        (status = 200, description = "Relations stored and the dataset registered", body = Job),
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
    ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PublishRelationsRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    let job = state
        .db
        .get_job(id.as_str())
        .await
        .ok_or(JobApiError::NotFound)?;
    if job.created_by != ctx.user_id {
        return Err(JobApiError::NotFound);
    }

    let relations = payload.relations;
    let for_catalog = relations.clone();
    let updated = state
        .db
        .update_job(id.as_str(), move |job| job.relations = relations)
        .await
        .map_err(JobApiError::Internal)?;

    // Register the output in the DuckLake catalog as one atomic snapshot —
    // FIRE-AND-FORGET. The data is already durable at the sink, so a slow or
    // failing catalog write must never delay (or fail) this call. The detached
    // task does the remote footer reads off the request path; whatever it
    // misses, the reconciler picks up on its next pass, from the relations this
    // call just stored.
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
    _ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    let job = state
        .db
        .get_job(id.as_str())
        .await
        .ok_or(JobApiError::NotFound)?;

    if matches!(job.status, JobStatus::Pending | JobStatus::Running) {
        return Err(JobApiError::StillRunning);
    }

    state
        .db
        .remove_job(id.as_str())
        .await
        .map_err(JobApiError::Internal)?;

    // Drop the job's dataset from the catalog so governance stops listing a ghost
    // — BYOS-safe (only catalog metadata, never the member's Parquet). Whatever
    // this misses, the reconciler's deregister pass cleans up.
    if let Some(catalog) = state.catalog.clone() {
        let job_id = id.clone();
        tokio::spawn(async move {
            if let Ok(Err(e)) =
                tokio::task::spawn_blocking(move || catalog.unregister(&job_id)).await
            {
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
    _ctx: Require<IsDataPlane>,
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
    _ctx: Require<IsDataPlane>,
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
