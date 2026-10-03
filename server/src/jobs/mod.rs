pub mod dashboards;
pub mod persistence;

use axum::http::StatusCode;
use rusqlite::Connection;

use crate::credentials::sealing::SecretKey;
use crate::database::Database;
use crate::domain::{Job, StorageCredentialInput, StorageLocation};
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

/// Take over the jobs the bootstrap file declared for this member's verified
/// email: the instance declares people by address before they first sign in,
/// and a job is its creator's, so the first sight of the address settles whose.
pub async fn claim_declared(
    db: &Database,
    user_id: &str,
    email: Option<&str>,
) -> Result<(), Refusal> {
    let Some(email) = email else { return Ok(()) };
    let declared = crate::bootstrap::declared_for(email);
    if persistence::list_of(&*db.read().await, &declared)?.is_empty() {
        return Ok(());
    }
    persistence::reassign(&*db.write().await, &declared, user_id)?;
    Ok(())
}

/// The job, whoever created it: for the owner, who reads every completed job
/// of the workspace and changes none. Not swept: a caller whose answer turns
/// on whether a run is still held sweeps first.
pub fn any(conn: &Connection, id: &str) -> Result<Job, Refusal> {
    persistence::get(conn, id)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::JobNotFound, "No such job"))
}

/// The job, if it exists and `user_id` created it. Anyone else's job is not
/// found: a job is its creator's alone.
pub fn owned(conn: &Connection, user_id: &str, id: &str) -> Result<Job, Refusal> {
    let job = any(conn, id)?;
    if job.created_by != user_id {
        return Err(Refusal::not_found(ErrorCode::JobNotFound, "No such job"));
    }
    Ok(job)
}

/// Where `job`'s corpus lives, `{sink}/{folder}/`, as the sink's secret
/// reaches it, and that secret.
pub fn output(
    conn: &Connection,
    key: &SecretKey,
    job: &Job,
) -> Result<(StorageLocation, StorageCredentialInput), Refusal> {
    let sink =
        crate::connections::persistence::get(conn, &job.sink_connection)?.ok_or_else(|| {
            Refusal::new(
                StatusCode::BAD_REQUEST,
                ErrorCode::JobNoDestination,
                "The job's destination connection no longer exists",
            )
        })?;
    let (sink, spec) = crate::connections::storage(conn, key, &sink)?;
    // Only a draft has no folder, and a draft has no output.
    let output = job
        .output_under(&sink)
        .ok_or_else(|| Refusal::invalid("The job has no output folder"))?;
    Ok((output, spec))
}
