pub mod persistence;

use crate::database::Database;
use crate::domain::Job;
use crate::error::{ErrorCode, Refusal};

/// End the jobs no runner holds ([`persistence::sweep`]). Every read of jobs
/// calls it first, so no one is ever shown a run that has stopped as running.
pub async fn sweep(db: &Database) -> Result<(), Refusal> {
    let swept = persistence::sweep(&*db.write().await, jiff::Timestamp::now())?;
    if swept > 0 {
        tracing::info!(swept, "jobs abandoned by their runner marked failed");
    }
    Ok(())
}

/// The job, if it exists and `user_id` created it. Anyone else's job is not
/// found: a job is its creator's alone.
pub async fn owned(db: &Database, user_id: &str, id: &str) -> Result<Job, Refusal> {
    sweep(db).await?;
    persistence::get(&*db.read().await, id)?
        .filter(|job| job.created_by == user_id)
        .ok_or_else(|| Refusal::not_found(ErrorCode::JobNotFound, "No such job"))
}
