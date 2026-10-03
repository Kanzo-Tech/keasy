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
    caller.ensure_may_modify(&job.provenance.created_by.id, "job")?;
    Ok(job)
}

/// The job as `caller` is shown it: who may change and stop it, and where its
/// output lands — as the sink's URL spells it, without reaching for the
/// sink's secret.
pub fn present(conn: &Connection, caller: &Caller, mut job: Job) -> Result<Job, Refusal> {
    let sink = crate::connections::persistence::get(conn, &job.sink_connection)?;
    job.output = sink
        .and_then(|sink| StorageLocation::parse(&sink.target.url).ok())
        .and_then(|sink| job.output_under(&sink))
        .map(|output| output.to_string());
    Ok(job.seen_by(caller))
}

/// Move job `id` as `step` says, from what is stored: read it, step it, and
/// write it back only if no one moved it meanwhile; if someone did, step what
/// they left. `step` refuses what the state no longer allows — the second of
/// two runs started at once meets the first's `running`.
pub async fn transition(
    db: &Database,
    id: &str,
    mut step: impl FnMut(&mut Job) -> Result<(), Refusal>,
) -> Result<Job, Refusal> {
    for _ in 0..3 {
        let was = any(&*db.read().await, id)?;
        let mut job = was.clone();
        step(&mut job)?;
        if persistence::write(&*db.write().await, &job, &was)? {
            return Ok(job);
        }
    }
    tracing::warn!(job = id, "a job kept moving under three tries to move it");
    Err(Refusal::internal())
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
