//! The draft the environment declares.
//!
//! `KEASY_BOOTSTRAP_DRAFT` names a program file — in dev, the one that maps the
//! seeded bucket — so a fresh instance opens with a job ready to launch. A job
//! belongs to the member who created it, and at boot there is no member to give
//! it to, so the draft is created for the first member who lists jobs in an
//! instance that holds none. Once any job exists the environment has nothing
//! left to say.
//!
//! A missing file or sink is logged and the list is served without the draft.

use tracing::{info, warn};

use crate::connections::bootstrap::env_nonblank;
use crate::db::{Database, DbResult};

use super::models::{CreateJobRequest, Job, JobStatus};

pub async fn claim_declared_draft(db: &Database, user_id: &str) -> DbResult<()> {
    let Some(path) = env_nonblank("KEASY_BOOTSTRAP_DRAFT") else {
        return Ok(());
    };
    if db.has_jobs().await? {
        return Ok(());
    }
    let Some(sink) = db.get_sink_connection().await? else {
        warn!(%path, "declared draft: no sink to write to, skipped");
        return Ok(());
    };
    let script = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            warn!(%path, error = %e, "declared draft: unreadable, skipped");
            return Ok(());
        }
    };

    let request = CreateJobRequest {
        script,
        name: env_nonblank("KEASY_BOOTSTRAP_DRAFT_NAME"),
        mode: None,
        dcat_enabled: None,
        connection_ids: Vec::new(),
        sink_connection_id: sink.id,
        draft: true,
    };
    let job = Job::requested(JobStatus::Draft, request, user_id.to_string());
    if db.insert_first_job(&job).await? {
        info!(id = %job.id, %path, "declared draft ready");
    }
    Ok(())
}
