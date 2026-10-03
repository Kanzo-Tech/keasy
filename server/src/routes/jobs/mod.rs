pub mod dashboard;

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
use crate::domain::{Job, JobFolder, JobStatus, ResourceName, now_iso8601};
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
    /// out; it needs one, no other job's, to be submitted.
    #[schema(value_type = Option<JobFolder>)]
    pub folder: Option<String>,
}

/// Edits to a draft: as it is written (PATCH), and as it is submitted.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct DraftEdits {
    pub script: Option<String>,
    #[schema(value_type = Option<ResourceName>)]
    pub name: Option<String>,
    /// The draft's folder under the sink, spelled as on create. Submitting
    /// needs one, unless the draft holds one already.
    #[schema(value_type = Option<JobFolder>)]
    pub folder: Option<String>,
}

impl DraftEdits {
    /// Checked, then applied to `job`.
    fn apply(self, job: &mut Job) -> Result<(), Refusal> {
        let name = name(self.name)?;
        let folder = folder(self.folder.as_deref())?;
        if let Some(script) = self.script {
            job.script = Some(script);
        }
        if let Some(name) = name {
            job.name = Some(name);
        }
        if let Some(folder) = folder {
            job.folder = Some(folder.into_inner());
        }
        Ok(())
    }
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

/// What the runner reports of a job's run (POST `/v1/jobs/{id}/status`): that
/// it runs, again every so often to hold its lease, and how it ended. The
/// browser runs the program (`@fossil-lang/executor`) and writes the output
/// with a credential vended for the job; keasy only records.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct JobStatusReport {
    /// `running` (the first time it starts the run, every time after it renews
    /// the lease), or the end: `completed`, `failed` or `cancelled`.
    pub status: JobStatus,
    /// fossil's run report (on `completed`), stored verbatim and never read.
    #[serde(default)]
    #[schema(value_type = Option<Value>)]
    pub report: Option<serde_json::Value>,
    /// Why the run failed (on `failed`): the run's problem, stored verbatim
    /// and opaque.
    #[serde(default)]
    #[schema(value_type = Option<Value>)]
    pub problem: Option<serde_json::Value>,
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
        (status = 201, description = "The draft, created; `POST /v1/jobs/{id}/submit` makes it the job to run", body = Job),
        (status = 400, description = "The destination is not a sink, or the name or folder is misspelled (`data.field`)", body = ErrorBody),
    )
)]
/// A job begins as a draft, always: what it runs, where it lands. Submitting
/// it is the one way a job comes to run.
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
            ErrorCode::JobInvalidDestination,
            "sink_connection must name the workspace sink",
        ));
    }

    let job = Job::new(
        name(payload.name)?,
        payload.sink_connection,
        folder(payload.folder.as_deref())?,
        payload.script,
        member.user_id,
    );
    persistence::insert(&*state.db.write().await, &job)?;

    Ok((StatusCode::CREATED, Json(job)))
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

#[utoipa::path(patch, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = DraftEdits,
    responses(
        (status = 200, description = "The draft, edited", body = Job),
        (status = 400, description = "The name or folder is misspelled (`data.field`)", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
        (status = 409, description = "Not a draft: `job/not-draft`", body = ErrorBody),
    )
)]
pub async fn edit_draft(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(edits): Json<DraftEdits>,
) -> Result<impl IntoResponse, Refusal> {
    let mut job = draft(&state, &member, &id).await?;
    edits.apply(&mut job)?;
    persistence::write(&*state.db.write().await, &job)?;
    Ok(Json(job))
}

#[utoipa::path(post, path = "/v1/jobs/{id}/submit", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = DraftEdits,
    responses(
        (status = 202, description = "The draft is now the job to run, under the same id", body = Job),
        (status = 400, description = "The name or folder is missing or misspelled (`data.field`)", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
        (status = 409, description = "Not a draft (`job/not-draft`), or another job writes to that folder already (`job/folder-taken`; the job stays a draft, unchanged)", body = ErrorBody),
    )
)]
/// A draft becomes the job to run, in place: the edits, the folder check and
/// the promotion are one write, so a refusal leaves the draft as it was and a
/// success leaves no draft behind. The only way a job comes to be pending.
pub async fn submit_job(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(edits): Json<DraftEdits>,
) -> Result<impl IntoResponse, Refusal> {
    let mut job = draft(&state, &member, &id).await?;
    edits.apply(&mut job)?;
    if job.folder.is_none() {
        return Err(Refusal::invalid_field(
            "folder",
            "A job to run needs a folder for its output",
        ));
    }
    job.status = JobStatus::Pending;
    // The sweep fails a `pending` job older than the lease by `created_at`: a
    // draft's would sweep it the moment it is submitted.
    job.created_at = now_iso8601();
    persistence::write(&*state.db.write().await, &job)?;

    Ok((StatusCode::ACCEPTED, Json(job)))
}

/// The caller's job, if it is still a draft.
async fn draft(state: &AppState, member: &Member, id: &str) -> Result<Job, Refusal> {
    let job = owned(&state.db, &member.user_id, id).await?;
    if job.status != JobStatus::Draft {
        return Err(Refusal::conflict(
            ErrorCode::JobNotDraft,
            "Only a draft is edited or submitted",
        ));
    }
    Ok(job)
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
            ErrorCode::JobInvalidDestination,
            "Only the workspace sink holds job folders",
        ));
    }
    let folder = JobFolder::parse(&folder_name).map_err(|e| Refusal::invalid_field("folder", e))?;
    let taken = persistence::folder_taken(&*state.db.read().await, &name, folder.as_ref())?;
    Ok(Json(FolderAvailability { available: !taken }))
}

#[utoipa::path(post, path = "/v1/jobs/{id}/status", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = JobStatusReport,
    responses(
        (status = 200, description = "The job, as the report leaves it", body = Job),
        (status = 400, description = "The job is a draft, which is never run, or the status is not running or an end", body = ErrorBody),
        (status = 404, description = "Job not found", body = ErrorBody),
        (status = 409, description = "The job has already ended (`job/ended`): the sweep's `job/abandoned` among them", body = ErrorBody),
    )
)]
/// The runner's one report: `running` starts the run and, sent again, renews
/// its lease — a running job no report has renewed for the lease (60 s) is
/// swept as `job/abandoned`; an end records how the run ended, and dates it.
/// `completed` stores the run report verbatim, unread.
pub async fn report_status(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<JobStatusReport>,
) -> Result<impl IntoResponse, Refusal> {
    let JobStatusReport {
        status,
        report,
        problem,
    } = payload;
    // A run moves forward only: to running, or to an end. Never back to a
    // draft or to pending.
    if matches!(status, JobStatus::Draft | JobStatus::Pending) {
        return Err(Refusal::invalid(
            "A run reports running, completed, failed or cancelled",
        ));
    }
    // Only a submitted job is run: a draft never is, and an ended one — the
    // sweep's `job/abandoned` among them — stays ended.
    let mut job = owned(&state.db, &member.user_id, &id).await?;
    match job.status {
        JobStatus::Pending | JobStatus::Running => {}
        JobStatus::Draft => {
            return Err(Refusal::invalid("A draft is never run: submit it first"));
        }
        JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled => {
            return Err(Refusal::conflict(
                ErrorCode::JobEnded,
                "The job has already ended, so it has no run to report",
            ));
        }
    }

    let now = now_iso8601();
    // A cancelled job may have been stopped before it ever started.
    if status != JobStatus::Cancelled {
        job.started_at.get_or_insert_with(|| now.clone());
    }
    match &status {
        JobStatus::Running => job.heartbeat_at = Some(now.clone()),
        JobStatus::Completed => {
            job.report = report;
            job.problem = None;
        }
        JobStatus::Failed => job.problem = problem,
        _ => {}
    }
    if status != JobStatus::Running {
        job.completed_at = Some(now);
    }
    job.status = status;
    persistence::write(&*state.db.write().await, &job)?;
    Ok(Json(job))
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
        return Err(Refusal::conflict(
            ErrorCode::JobStillRunning,
            "Cannot delete a job that is still running",
        ));
    }

    persistence::delete(&*state.db.write().await, &id)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Why a job that is not running cannot be written or reported on: it has
/// ended, or it has not begun.
pub(crate) fn not_running(status: &JobStatus) -> Refusal {
    if status.has_ended() {
        Refusal::conflict(ErrorCode::JobEnded, "The job has ended")
    } else {
        Refusal::conflict(ErrorCode::JobNotRunning, "The job is not running yet")
    }
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_jobs, create_job))
        .routes(routes!(get_job, edit_draft, delete_job))
        .routes(routes!(submit_job))
        .routes(routes!(report_status))
        .routes(routes!(folder_availability))
}
