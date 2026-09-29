pub mod output;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::Member;
use crate::domain::{Job, JobStatus, OutputRelation, RelativePath, now_iso8601};
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::jobs::{owned, persistence};
use crate::startup::AppState;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateJobRequest {
    pub script: String,
    pub name: Option<String>,
    /// Where the output lands: the sink connection's name.
    pub sink_connection: String,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateJobRequest {
    pub script: Option<String>,
    pub name: Option<String>,
}

/// The browser-driven completion payload (PATCH `/v1/jobs/{id}`): after running
/// the mapping in the browser (`@fossil-lang/executor`) and writing the output
/// with the credential vended for the job, the client reports the run's outcome. `manifest` is the
/// executor's run report, stored verbatim and never read.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CompleteJobRequest {
    /// The terminal (or `Running`) status the client is transitioning the job to.
    pub status: JobStatus,
    /// The run report for the uploaded output (on `Completed`) — opaque JSON.
    #[serde(default)]
    #[schema(value_type = Option<Value>)]
    pub manifest: Option<serde_json::Value>,
    /// Failure message (on `Failed`), stored verbatim.
    #[serde(default)]
    pub error: Option<String>,
}

/// What the corpus reader enumerated for a finished job (PUT
/// `/v1/jobs/{id}/relations`). It arrives after completion because naming a
/// relation is the corpus's answer, not the report's: only a reader with the
/// manifests in hand can say what the dataset is called and which files carry
/// it.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PublishRelationsRequest {
    pub relations: Vec<OutputRelation>,
}

#[utoipa::path(get, path = "/v1/jobs", tag = "Jobs",
    responses(
        (status = 200, description = "The caller's jobs", body = Vec<Job>),
    )
)]
pub async fn list_jobs(
    member: Member,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Refusal> {
    Ok(Json(persistence::list_of(
        &*state.db.read().await,
        &member.user_id,
    )?))
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
) -> Result<impl IntoResponse, Refusal> {
    let is_sink =
        crate::connections::persistence::get(&*state.db.read().await, &payload.sink_connection)?
            .is_some_and(|c| c.target.is_sink());
    if !is_sink {
        return Err(Refusal::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidDestination,
            "sink_connection must name the workspace sink",
        ));
    }

    // A `Pending` job is run by the browser: sources and output through
    // credentials vended per prefix, outcome by `PATCH /v1/jobs/{id}`.
    let (status, code) = if payload.draft {
        (JobStatus::Draft, StatusCode::CREATED)
    } else {
        (JobStatus::Pending, StatusCode::ACCEPTED)
    };
    let job = Job::new(
        status,
        payload.name,
        payload.sink_connection,
        payload.script,
        member.user_id,
    );
    persistence::insert(&*state.db.write().await, &job)?;

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
) -> Result<impl IntoResponse, Refusal> {
    Ok(Json(owned(&state.db, &member.user_id, &id).await?))
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
) -> Result<impl IntoResponse, Refusal> {
    if owned(&state.db, &member.user_id, &id).await?.status != JobStatus::Draft {
        return Err(Refusal::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::NotDraft,
            "Only draft jobs can be updated",
        ));
    }
    persistence::update(&*state.db.write().await, &id, |job| {
        if let Some(script) = payload.script {
            job.script = Some(script);
        }
        if let Some(name) = payload.name {
            job.name = Some(name);
        }
    })?
    .map(Json)
    .ok_or_else(|| Refusal::not_found("Job"))
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
) -> Result<impl IntoResponse, Refusal> {
    owned(&state.db, &member.user_id, &id).await?;
    let now = now_iso8601();
    let CompleteJobRequest {
        status,
        manifest,
        error,
    } = payload;

    persistence::update(&*state.db.write().await, &id, move |job| {
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
    })?
    .map(Json)
    .ok_or_else(|| Refusal::not_found("Job"))
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
) -> Result<impl IntoResponse, Refusal> {
    owned(&state.db, &member.user_id, &id).await?;

    let relations = payload.relations;
    for file in relations.iter().flat_map(|r| &r.files) {
        RelativePath::parse(file)
            .map_err(|e| Refusal::new(StatusCode::BAD_REQUEST, ErrorCode::InvalidFormat, e))?;
    }
    persistence::update(&*state.db.write().await, &id, move |job| {
        job.relations = relations
    })?
    .map(Json)
    .ok_or_else(|| Refusal::not_found("Job"))
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
) -> Result<impl IntoResponse, Refusal> {
    let job = owned(&state.db, &member.user_id, &id).await?;
    if matches!(job.status, JobStatus::Pending | JobStatus::Running) {
        return Err(Refusal::new(
            StatusCode::CONFLICT,
            ErrorCode::StillRunning,
            "Cannot delete a job that is still running",
        ));
    }

    persistence::delete(&*state.db.write().await, &id)?;
    Ok(StatusCode::NO_CONTENT)
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_jobs, create_job))
        .routes(routes!(get_job, update_job, complete_job, delete_job))
        .routes(routes!(publish_relations))
}
