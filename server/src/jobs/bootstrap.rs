//! The draft the environment declares, ensured at boot.
//!
//! `KEASY_BOOTSTRAP_DRAFT` names a program file — in dev, the one that maps the
//! seeded bucket — so a fresh instance opens with a job ready to launch. It is
//! declared only into an instance with no jobs at all: once anyone has saved,
//! launched or edited one, the environment has nothing left to say.
//!
//! The draft goes out with the workspace sink as its destination. Its
//! `created_by` is the declaration, not a person: launching a draft replaces it
//! with a job created by whoever launched it, and only that job's owner is ever
//! checked.
//!
//! Non-fatal, like the declared connections: anything missing is logged and the
//! instance serves without it.

use tracing::{info, warn};

use crate::connections::bootstrap::env_nonblank;
use crate::db::Database;

use super::models::{CreateJobRequest, Job, JobStatus};

const DECLARED_BY: &str = "bootstrap";

pub async fn ensure_declared_draft(db: &Database) {
    let Some(path) = env_nonblank("KEASY_BOOTSTRAP_DRAFT") else {
        return;
    };
    if !db.list_jobs().await.is_empty() {
        return;
    }
    let script = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            warn!(%path, error = %e, "declared draft: unreadable, skipped");
            return;
        }
    };

    let request = CreateJobRequest {
        script,
        name: env_nonblank("KEASY_BOOTSTRAP_DRAFT_NAME"),
        mode: None,
        dcat_enabled: None,
        connection_ids: Vec::new(),
        sink_connection_id: db.get_sink_connection().await.map(|c| c.id),
        draft: true,
    };
    let job = Job::requested(JobStatus::Draft, request, DECLARED_BY.to_string());
    match db.insert_job(&job).await {
        Ok(()) => info!(id = %job.id, %path, "declared draft ready"),
        Err(e) => warn!(%path, error = %e, "declared draft: rejected"),
    }
}
