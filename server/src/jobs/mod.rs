pub mod dashboards;
pub mod persistence;

use axum::http::StatusCode;
use rusqlite::Connection;

use crate::authentication::role::Caller;
use crate::credentials::sealing::SecretKey;
use crate::database::Database;
use crate::domain::{Job, SecretSpec, StorageLocation};
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

/// The job, whoever created it: everyone in the workspace reads it. Not swept:
/// a caller whose answer turns on whether a run is still held sweeps first.
pub fn any(conn: &Connection, id: &str) -> Result<Job, Refusal> {
    persistence::get(conn, id)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::JobNotFound, "No such job"))
}

/// The job, if `caller` may change it — an admin, or the editor who created
/// it. Anyone else's is read, never changed: `rbac/forbidden`, not a 404, for
/// a job everyone can see exists.
pub fn changeable(conn: &Connection, caller: &Caller, id: &str) -> Result<Job, Refusal> {
    let job = any(conn, id)?;
    caller.ensure_may_modify(&job.created_by, "job")?;
    Ok(job)
}

/// Where `job`'s corpus lives, `{sink}/{folder}/`, as the sink's secret
/// reaches it, and that secret.
pub fn output(
    conn: &Connection,
    key: &SecretKey,
    job: &Job,
) -> Result<(StorageLocation, SecretSpec), Refusal> {
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
