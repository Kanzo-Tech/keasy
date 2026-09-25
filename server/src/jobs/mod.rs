pub mod persistence;

use crate::database::Database;
use crate::domain::{Job, JobStatus};
use crate::error::Refusal;

/// The job, if it exists and `user_id` created it. Anyone else's job is not
/// found: a job is its creator's alone.
pub async fn owned(db: &Database, user_id: &str, id: &str) -> Result<Job, Refusal> {
    persistence::get(&*db.read().await, id)?
        .filter(|job| job.created_by == user_id)
        .ok_or_else(|| Refusal::not_found("Job"))
}

/// Where a job's output lives: the destination the member chose, plus the job's
/// own id. **This is the one place keasy composes an output path**, and it is
/// keasy's to compose — a job's home is the host's decision, not the language's.
/// Everything below it (relation names, file names, tile names) belongs to
/// fossil and travels from fossil.
pub fn dataset_dest(base: &str, job_id: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), job_id)
}

/// A job as a create request asks for it: `Draft` or `Pending`, not yet run.
pub fn requested(
    status: JobStatus,
    name: Option<String>,
    sink_connection: String,
    script: String,
    created_by: String,
) -> Job {
    let id = uuid::Uuid::new_v4().to_string();
    Job {
        status,
        name: name.or_else(|| Some(id[..8].to_string())),
        created_at: now_iso8601(),
        started_at: None,
        completed_at: None,
        error: None,
        created_by,
        sink_connection,
        script: Some(script),
        manifest: None,
        relations: Vec::new(),
        id,
    }
}

pub fn now_iso8601() -> String {
    jiff::Timestamp::now()
        .strftime("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}
