//! The `jobs` table.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{
    DbError, DbResult, constraint, created_columns, enum_column, json_column_opt,
};
use crate::domain::Job;
use crate::error::{ErrorBody, ErrorCode};

const COLUMNS: &str = "id, name, status, created_at, started_at, completed_at, heartbeat_at, \
                       runner, cancel_requested, problem, created_by, created_by_name, \
                       sink_connection, folder, script, report";

/// What the schema refused about `job`, said in its terms.
fn refused(job: &Job, e: rusqlite::Error) -> DbError {
    use rusqlite::ffi;
    match constraint(&e) {
        Some(ffi::SQLITE_CONSTRAINT_UNIQUE) => DbError::FolderTaken(format!(
            "another job writes to the folder {:?} already",
            job.folder.as_deref().unwrap_or_default()
        )),
        Some(ffi::SQLITE_CONSTRAINT_CHECK) => {
            DbError::Invalid("a job that is not a draft needs a folder, and a run a runner".into())
        }
        _ => e.into(),
    }
}

pub fn insert(conn: &Connection, job: &Job) -> DbResult<()> {
    conn.execute(
        &format!(
            "INSERT INTO jobs ({COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"
        ),
        params![
            job.id,
            job.name,
            job.status.as_ref(),
            job.provenance.created_at,
            job.started_at,
            job.completed_at,
            job.heartbeat_at,
            job.runner,
            job.cancel_requested,
            job.problem
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            job.provenance.created_by.id,
            job.provenance.created_by.name,
            job.sink_connection,
            job.folder,
            job.script,
            job.report.as_ref().map(serde_json::to_string).transpose()?,
        ],
    )
    .map_err(|e| refused(job, e))?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> DbResult<Option<Job>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM jobs WHERE id = ?1"),
            [id],
            row_to_job,
        )
        .optional()?)
}

/// Store `job` over its row, if the row is still as `was` read it — in the
/// same status, held by the same runner: a compare-and-set, so of two moves
/// made from one reading only the first lands. False when the row moved on
/// meanwhile; the caller reads it again. Refused whole: a refused write leaves
/// the row as it was.
pub fn write(conn: &Connection, job: &Job, was: &Job) -> DbResult<bool> {
    let written = conn
        .execute(
            "UPDATE jobs SET name = ?1, status = ?2, started_at = ?3, completed_at = ?4,
                             problem = ?5, script = ?6, report = ?7, folder = ?8,
                             heartbeat_at = ?10, runner = ?11, cancel_requested = ?12
             WHERE id = ?9 AND status = ?13 AND runner IS ?14",
            params![
                job.name,
                job.status.as_ref(),
                job.started_at,
                job.completed_at,
                job.problem
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                job.script,
                job.report.as_ref().map(serde_json::to_string).transpose()?,
                job.folder,
                job.id,
                job.heartbeat_at,
                job.runner,
                job.cancel_requested,
                was.status.as_ref(),
                was.runner,
            ],
        )
        .map_err(|e| refused(job, e))?;
    Ok(written == 1)
}

/// How long a runner may go without a heartbeat before its run is swept as
/// abandoned. Published as `x-keasy-bounds.job_lease_ms`; the browser's runner
/// beats four times within it, so one lost request is not an abandoned run.
pub const LEASE: std::time::Duration = std::time::Duration::from_secs(60);

/// End every run no runner is holding: `running` with a lease — taken by
/// `run`, renewed by each `running` — older than [`LEASE`]. Each becomes
/// `failed` with the problem `job/abandoned`. Nothing else is swept: an idle
/// job waits for someone to run it, for as long as it takes.
///
/// Run before every read of jobs rather than on a schedule: a tab that closed
/// cannot say so, and the next person to look is the only one who can notice.
pub fn sweep(conn: &Connection, now: jiff::Timestamp) -> DbResult<usize> {
    let problem = serde_json::to_string(&ErrorBody::new(
        ErrorCode::JobAbandoned,
        format!(
            "Nothing ran this job for {} s: the tab that ran it closed",
            LEASE.as_secs()
        ),
        Vec::new(),
    ))?;
    Ok(conn.execute(
        "UPDATE jobs SET status = 'failed', completed_at = ?1, problem = ?2, cancel_requested = 0
         WHERE status = 'running'
           AND COALESCE(heartbeat_at, started_at, created_at) < ?3",
        params![spell(now), problem, lapsed(now)],
    )?)
}

/// A timestamp as the table stores it.
fn spell(t: jiff::Timestamp) -> String {
    t.strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// A lease taken before this has lapsed.
fn lapsed(now: jiff::Timestamp) -> String {
    spell(now - jiff::SignedDuration::try_from(LEASE).expect("a lease fits"))
}

/// Renew the lease of `id`, run by `runner`, if it has not lapsed: the
/// runner's beat, one statement. Whether the run is asked to stop, or `None`
/// when there was nothing to renew, and the caller reads the row to say why.
pub fn renew(
    conn: &Connection,
    id: &str,
    runner: &str,
    now: jiff::Timestamp,
) -> DbResult<Option<bool>> {
    Ok(conn
        .query_row(
            "UPDATE jobs SET heartbeat_at = ?1
             WHERE id = ?2 AND runner = ?3 AND status = 'running'
               AND COALESCE(heartbeat_at, started_at, created_at) >= ?4
             RETURNING cancel_requested",
            params![spell(now), id, runner, lapsed(now)],
            |row| row.get(0),
        )
        .optional()?)
}

/// Every job in the workspace, the newest first: the work is shared.
pub fn list(conn: &Connection) -> DbResult<Vec<Job>> {
    let jobs = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM jobs ORDER BY created_at DESC"
        ))?
        .query_map([], row_to_job)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(jobs)
}

pub fn delete(conn: &Connection, id: &str) -> DbResult<()> {
    conn.execute("DELETE FROM jobs WHERE id = ?1", [id])?;
    Ok(())
}

fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<Job> {
    Ok(Job {
        id: row.get("id")?,
        name: row.get("name")?,
        status: enum_column(row, "status")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        heartbeat_at: row.get("heartbeat_at")?,
        runner: row.get("runner")?,
        cancel_requested: row.get("cancel_requested")?,
        problem: json_column_opt(row, "problem")?,
        provenance: created_columns(row)?,
        sink_connection: row.get("sink_connection")?,
        folder: row.get("folder")?,
        output: None,
        script: row.get("script")?,
        report: json_column_opt(row, "report")?,
        can_modify: false,
        can_stop: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{JobFolder, JobStatus};

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        crate::connections::persistence::tests::seed_sink(&conn, "sink");
        conn
    }

    fn actor(id: &str) -> crate::domain::Actor {
        crate::domain::Actor {
            id: id.into(),
            name: id.into(),
        }
    }

    fn job(owner: &str) -> Job {
        Job::new(None, "sink".into(), None, "x".into(), actor(owner))
    }

    fn filed(status: JobStatus, folder: &str) -> Job {
        Job {
            runner: (status == JobStatus::Running).then(|| "u-1".into()),
            status,
            ..Job::new(
                None,
                "sink".into(),
                Some(JobFolder::parse(folder).unwrap()),
                "x".into(),
                actor("u-1"),
            )
        }
    }

    /// One folder, one job's output: drafts may share it, and the folder is
    /// free again once its job is gone.
    #[test]
    fn a_folder_holds_one_jobs_output() {
        let conn = conn();
        insert(&conn, &filed(JobStatus::Draft, "people")).unwrap();
        insert(&conn, &filed(JobStatus::Draft, "people")).unwrap();
        let first = filed(JobStatus::Idle, "people");
        insert(&conn, &first).unwrap();

        let second = filed(JobStatus::Idle, "people");
        assert!(matches!(
            insert(&conn, &second),
            Err(DbError::FolderTaken(_))
        ));
        insert(&conn, &filed(JobStatus::Idle, "orders")).unwrap();

        delete(&conn, &first.id).unwrap();
        insert(&conn, &second).unwrap();
    }

    /// Only a draft goes without a folder, and it cannot leave draft without one.
    #[test]
    fn only_a_draft_goes_without_a_folder() {
        let conn = conn();
        let mut idle = job("u-1");
        idle.status = JobStatus::Idle;
        assert!(matches!(insert(&conn, &idle), Err(DbError::Invalid(_))));

        let draft = job("u-1");
        insert(&conn, &draft).unwrap();
        let promoted = Job {
            status: JobStatus::Idle,
            ..draft.clone()
        };
        assert!(matches!(
            write(&conn, &promoted, &draft),
            Err(DbError::Invalid(_))
        ));
    }

    /// A row that does not decode is an error, not a job with defaults filled in.
    #[test]
    fn a_corrupt_row_is_an_error_not_a_default() {
        let conn = conn();
        let stored = filed(JobStatus::Draft, "people");
        insert(&conn, &stored).unwrap();
        conn.execute("UPDATE jobs SET status = 'exploded'", [])
            .unwrap();

        assert!(get(&conn, &stored.id).is_err());
        assert!(list(&conn).is_err());

        assert!(
            conn.execute("UPDATE jobs SET status = 'draft', report = 'not json'", [])
                .is_err(),
            "a report that is not JSON is never stored"
        );
    }

    fn at(job: &Job, conn: &Connection) -> Job {
        get(conn, &job.id).unwrap().unwrap()
    }

    #[test]
    fn only_a_run_no_runner_holds_is_swept_to_failed_as_abandoned() {
        let conn = conn();
        let now = jiff::Timestamp::now();
        let ago = |s: i64| {
            (now - jiff::SignedDuration::from_secs(s))
                .strftime("%Y-%m-%dT%H:%M:%SZ")
                .to_string()
        };
        let mut stale = filed(JobStatus::Running, "stale");
        stale.started_at = Some(ago(300));
        stale.heartbeat_at = Some(ago(61));
        let mut alive = filed(JobStatus::Running, "alive");
        alive.started_at = Some(ago(300));
        alive.heartbeat_at = Some(ago(10));
        let mut waiting = filed(JobStatus::Idle, "waiting");
        waiting.provenance.created_at = ago(3600);
        let mut done = filed(JobStatus::Completed, "done");
        done.heartbeat_at = Some(ago(3600));
        let draft = job("u-1");
        for j in [&stale, &alive, &waiting, &done, &draft] {
            insert(&conn, j).unwrap();
        }

        assert_eq!(sweep(&conn, now).unwrap(), 1);

        let read = at(&stale, &conn);
        assert_eq!(read.status, JobStatus::Failed);
        assert_eq!(read.problem.as_ref().unwrap()["code"], "job/abandoned");
        assert!(read.completed_at.is_some());
        assert_eq!(at(&alive, &conn).status, JobStatus::Running);
        assert_eq!(at(&waiting, &conn).status, JobStatus::Idle, "idle waits");
        assert_eq!(at(&done, &conn).status, JobStatus::Completed);
        assert_eq!(at(&draft, &conn).status, JobStatus::Draft);
        assert_eq!(sweep(&conn, now).unwrap(), 0, "a swept job is swept once");
    }

    /// Two moves made from one reading: the first lands, the second finds the
    /// row moved on and writes nothing.
    #[test]
    fn a_write_lands_only_on_the_row_it_read() {
        let conn = conn();
        let idle = filed(JobStatus::Idle, "people");
        insert(&conn, &idle).unwrap();
        let mut mine = idle.clone();
        mine.run("u-1").unwrap();
        let mut theirs = idle.clone();
        theirs.run("u-2").unwrap();

        assert!(write(&conn, &mine, &idle).unwrap());
        assert!(!write(&conn, &theirs, &idle).unwrap());
        assert_eq!(at(&idle, &conn).runner.as_deref(), Some("u-1"));
    }

    #[test]
    fn the_runner_alone_renews_and_hears_a_stop() {
        let conn = conn();
        let now = jiff::Timestamp::now();
        let running = filed(JobStatus::Running, "people");
        insert(&conn, &running).unwrap();
        assert_eq!(renew(&conn, &running.id, "u-1", now).unwrap(), Some(false));
        assert_eq!(renew(&conn, &running.id, "u-2", now).unwrap(), None);
        conn.execute("UPDATE jobs SET cancel_requested = 1", [])
            .unwrap();
        assert_eq!(renew(&conn, &running.id, "u-1", now).unwrap(), Some(true));
    }
}
