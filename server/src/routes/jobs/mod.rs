pub mod dashboard;
pub mod output;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::Member;
use crate::domain::{
    Job, JobFolder, JobStatus, OutputRelation, RelativePath, ResourceName, now_iso8601,
};
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::jobs::{owned, persistence};
use crate::startup::AppState;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateJobRequest {
    pub script: String,
    #[schema(value_type = Option<ResourceName>)]
    pub name: Option<String>,
    /// Where the output lands: the sink connection's name.
    pub sink_connection: String,
    /// The folder under the sink the output lands in. A draft may leave it
    /// out; a job to run needs one no other job in the sink holds.
    #[schema(value_type = Option<JobFolder>)]
    pub folder: Option<String>,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateJobRequest {
    pub script: Option<String>,
    #[schema(value_type = Option<ResourceName>)]
    pub name: Option<String>,
    /// The draft's folder under the sink, spelled as on create.
    #[schema(value_type = Option<JobFolder>)]
    pub folder: Option<String>,
}

/// A draft's final edits as it becomes a job to run, spelled as on update.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SubmitJobRequest {
    pub script: Option<String>,
    #[schema(value_type = Option<ResourceName>)]
    pub name: Option<String>,
    /// Needed unless the draft holds one already.
    #[schema(value_type = Option<JobFolder>)]
    pub folder: Option<String>,
}

/// Whether a folder of the sink is free for a job to run.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FolderAvailability {
    pub available: bool,
}

/// The folder a request names, parsed.
fn folder(folder: Option<&str>) -> Result<Option<JobFolder>, Refusal> {
    folder
        .map(JobFolder::parse)
        .transpose()
        .map_err(|e| Refusal::invalid_field("folder", e))
}

/// The name a request gives the job, checked: a job is named as a connection is.
fn name(name: Option<String>) -> Result<Option<String>, Refusal> {
    if let Some(name) = &name {
        ResourceName::parse(name).map_err(|e| Refusal::invalid_field("name", e))?;
    }
    Ok(name)
}

/// A job leaves draft only with a folder.
fn no_folder() -> Refusal {
    Refusal::invalid_field("folder", "A job to run needs a folder for its output")
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
    /// Why the run failed (on `Failed`): the run's problem, stored verbatim
    /// and opaque.
    #[serde(default)]
    #[schema(value_type = Option<Value>)]
    pub problem: Option<serde_json::Value>,
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
    crate::jobs::claim_declared(&state.db, &member.user_id, member.email.as_deref()).await?;
    crate::jobs::sweep(&state.db).await?;
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
        (status = 400, description = "The destination is not a sink, or the name or folder is missing or misspelled (`data.field`)", body = ErrorBody),
        (status = 409, description = "Another job writes to that folder already: `job/folder-taken`", body = ErrorBody),
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

    let name = name(payload.name)?;
    let folder = folder(payload.folder.as_deref())?;
    if !payload.draft && folder.is_none() {
        return Err(no_folder());
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
        name,
        payload.sink_connection,
        folder,
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
        (status = 400, description = "Job is not a draft, or the name or folder is misspelled (`data.field`)", body = ErrorBody),
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
    let name = name(payload.name)?;
    let folder = folder(payload.folder.as_deref())?;
    persistence::update(&*state.db.write().await, &id, |job| {
        if let Some(script) = payload.script {
            job.script = Some(script);
        }
        if let Some(name) = name {
            job.name = Some(name);
        }
        if let Some(folder) = folder {
            job.folder = Some(folder.into_inner());
        }
    })?
    .map(Json)
    .ok_or_else(|| Refusal::not_found(ErrorCode::JobNotFound, "No such job"))
}

#[utoipa::path(post, path = "/v1/jobs/{id}/submit", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = SubmitJobRequest,
    responses(
        (status = 202, description = "The draft is now the job to run, under the same id", body = Job),
        (status = 400, description = "Job is not a draft (`job/not-draft`), or the name or folder is missing or misspelled (`data.field`)", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
        (status = 409, description = "Another job writes to that folder already: `job/folder-taken`; the job stays a draft, unchanged", body = ErrorBody),
    )
)]
/// A draft becomes the job to run, in place: the edits, the folder check and
/// the promotion are one write, so a refusal leaves the draft as it was and a
/// success leaves no draft behind.
pub async fn submit_job(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<SubmitJobRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let name = name(payload.name)?;
    let folder = folder(payload.folder.as_deref())?;
    crate::jobs::sweep(&state.db).await?;

    let conn = state.db.write().await;
    let mut job = persistence::get(&conn, &id)?
        .filter(|job| job.created_by == member.user_id)
        .ok_or_else(|| Refusal::not_found(ErrorCode::JobNotFound, "No such job"))?;
    if job.status != JobStatus::Draft {
        return Err(Refusal::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::NotDraft,
            "Only a draft is submitted",
        ));
    }
    if let Some(script) = payload.script {
        job.script = Some(script);
    }
    if let Some(name) = name {
        job.name = Some(name);
    }
    if let Some(folder) = folder {
        job.folder = Some(folder.into_inner());
    }
    if job.folder.is_none() {
        return Err(no_folder());
    }
    job.status = JobStatus::Pending;
    // The sweep fails a `pending` job older than the lease by `created_at`: a
    // draft's would sweep it the moment it is submitted.
    job.created_at = now_iso8601();
    persistence::write(&conn, &job)?;

    Ok((StatusCode::ACCEPTED, Json(job)))
}

#[utoipa::path(get, path = "/v1/connections/{name}/folders/{folder}", tag = "Jobs",
    params(
        ("name" = String, Path, description = "The sink connection's name"),
        ("folder" = JobFolder, Path, description = "The folder under the sink"),
    ),
    responses(
        (status = 200, description = "Whether a job to run may write to the folder", body = FolderAvailability),
        (status = 400, description = "The connection is not the sink (`job/invalid-destination`), or the folder is misspelled (`data.field`)", body = ErrorBody),
        (status = 404, description = "Connection not found", body = ErrorBody),
    )
)]
/// Whether a job to run may take `folder` in the sink: no job but a draft
/// holds it. It reveals only whether the folder is held, never whose job holds
/// it.
pub async fn folder_availability(
    _: Member,
    State(state): State<AppState>,
    Path((name, folder_name)): Path<(String, String)>,
) -> Result<impl IntoResponse, Refusal> {
    let connection = crate::connections::named(&state.db, &name).await?;
    if !connection.target.is_sink() {
        return Err(Refusal::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidDestination,
            "Only the workspace sink holds job folders",
        ));
    }
    let folder = JobFolder::parse(&folder_name).map_err(|e| Refusal::invalid_field("folder", e))?;
    let taken = persistence::folder_taken(&*state.db.read().await, &name, folder.as_ref())?;
    Ok(Json(FolderAvailability { available: !taken }))
}

#[utoipa::path(patch, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = CompleteJobRequest,
    responses(
        (status = 200, description = "Job status updated from the browser run", body = Job),
        (status = 400, description = "The job is a draft, which is never run, or the status is not running or an end", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
        (status = 409, description = "The job has already ended", body = ErrorBody),
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
    // Only a submitted job is run: a draft never is, and an ended one — the
    // sweep's `job/abandoned` among them — stays ended.
    match owned(&state.db, &member.user_id, &id).await?.status {
        JobStatus::Pending | JobStatus::Running => {}
        JobStatus::Draft => {
            return Err(Refusal::invalid("A draft is never run: submit it first"));
        }
        JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled => {
            return Err(Refusal::new(
                StatusCode::CONFLICT,
                ErrorCode::NotRunning,
                "The job has already ended, so it has no run to report",
            ));
        }
    }
    let CompleteJobRequest {
        status,
        manifest,
        problem,
    } = payload;
    // A run moves forward only: to running, or to an end. Never back to a
    // draft or to pending.
    if matches!(status, JobStatus::Draft | JobStatus::Pending) {
        return Err(Refusal::invalid(
            "A run reports running, completed, failed or cancelled",
        ));
    }
    let now = now_iso8601();

    persistence::update(&*state.db.write().await, &id, move |job| {
        // A cancelled job may have been stopped before it ever started.
        if status != JobStatus::Cancelled {
            job.started_at.get_or_insert_with(|| now.clone());
        }
        match &status {
            JobStatus::Running => job.heartbeat_at = Some(now.clone()),
            JobStatus::Completed => {
                job.manifest = manifest;
                job.problem = None;
            }
            JobStatus::Failed => job.problem = problem,
            _ => {}
        }
        if status != JobStatus::Running {
            job.completed_at = Some(now);
        }
        job.status = status;
    })?
    .map(Json)
    .ok_or_else(|| Refusal::not_found(ErrorCode::JobNotFound, "No such job"))
}

#[utoipa::path(post, path = "/v1/jobs/{id}/heartbeat", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 204, description = "The lease is renewed"),
        (status = 404, description = "Job not found", body = ErrorBody),
        (status = 409, description = "The job is not running: it ended, or the sweep ended it", body = ErrorBody),
    )
)]
/// The runner is still there. Sent every 15 s while the job runs; a running
/// job with no heartbeat for the lease (60 s) is swept as `job/abandoned`.
pub async fn heartbeat(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, Refusal> {
    if owned(&state.db, &member.user_id, &id).await?.status != JobStatus::Running {
        return Err(Refusal::new(
            StatusCode::CONFLICT,
            ErrorCode::NotRunning,
            "The job is not running, so it holds no lease",
        ));
    }
    let now = now_iso8601();
    persistence::update(&*state.db.write().await, &id, move |job| {
        job.heartbeat_at = Some(now)
    })?
    .ok_or_else(|| Refusal::not_found(ErrorCode::JobNotFound, "No such job"))?;
    Ok(StatusCode::NO_CONTENT)
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
    .ok_or_else(|| Refusal::not_found(ErrorCode::JobNotFound, "No such job"))
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
        .routes(routes!(heartbeat))
        .routes(routes!(submit_job))
        .routes(routes!(folder_availability))
}
