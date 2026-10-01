pub mod dashboards;
pub mod persistence;

use crate::database::Database;
use crate::domain::Job;
use crate::error::Refusal;

/// Take over the jobs the bootstrap file declared for this member's verified
/// email: the instance declares people by address before they first sign in,
/// and a job is its creator's, so the first sight of the address settles whose.
pub async fn claim_declared(db: &Database, user_id: &str, email: Option<&str>) -> Result<(), Refusal> {
    let Some(email) = email else { return Ok(()) };
    let declared = crate::bootstrap::declared_for(email);
    if persistence::list_of(&*db.read().await, &declared)?.is_empty() {
        return Ok(());
    }
    persistence::reassign(&*db.write().await, &declared, user_id)?;
    Ok(())
}

/// The job, if it exists and `user_id` created it. Anyone else's job is not
/// found: a job is its creator's alone.
pub async fn owned(db: &Database, user_id: &str, id: &str) -> Result<Job, Refusal> {
    persistence::get(&*db.read().await, id)?
        .filter(|job| job.created_by == user_id)
        .ok_or_else(|| Refusal::not_found("Job"))
}
