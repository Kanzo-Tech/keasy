pub mod dashboards;
pub mod persistence;

use crate::database::Database;
use crate::domain::Job;
use crate::error::Refusal;

/// The job, if it exists and `user_id` created it. Anyone else's job is not
/// found: a job is its creator's alone.
pub async fn owned(db: &Database, user_id: &str, id: &str) -> Result<Job, Refusal> {
    persistence::get(&*db.read().await, id)?
        .filter(|job| job.created_by == user_id)
        .ok_or_else(|| Refusal::not_found("Job"))
}
