//! The `jobs` table.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{DbError, DbResult, constraint, enum_column, json_column_opt};
use crate::domain::{Job, JobStatus};
use crate::error::{ErrorBody, ErrorCode};

const COLUMNS: &str = "id, name, status, created_at, started_at, completed_at, heartbeat_at, \
                       problem, created_by, sink_connection, folder, script, manifest, relations";

/// What the schema refused about `job`, said in its terms.
fn refused(job: &Job, e: rusqlite::Error) -> DbError {
    use rusqlite::ffi;
    match constraint(&e) {
        Some(ffi::SQLITE_CONSTRAINT_UNIQUE) => DbError::AlreadyExists(format!(
            "another job writes to the folder {:?} already",
            job.folder.as_deref().unwrap_or_default()
        )),
        Some(ffi::SQLITE_CONSTRAINT_CHECK) => {
            DbError::Invalid("a job that is not a draft needs a folder".into())
        }
        _ => e.into(),
    }
}

pub fn insert(conn: &Connection, job: &Job) -> DbResult<()> {
    conn.execute(
        &format!(
            "INSERT INTO jobs ({COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"
        ),
        params![
            job.id,
            job.name,
            job.status.as_ref(),
            job.created_at,
            job.started_at,
            job.completed_at,
            job.heartbeat_at,
            job.problem
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            job.created_by,
            job.sink_connection,
            job.folder,
            job.script,
            job.manifest
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            serde_json::to_string(&job.relations)?,
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

/// Apply `f` to the stored job and write it back; `None` if there is none.
pub fn update(conn: &Connection, id: &str, f: impl FnOnce(&mut Job)) -> DbResult<Option<Job>> {
    let Some(mut job) = get(conn, id)? else {
        return Ok(None);
    };
    f(&mut job);

    conn.execute(
        "UPDATE jobs SET name = ?1, status = ?2, started_at = ?3, completed_at = ?4, problem = ?5,
                         script = ?6, manifest = ?7, relations = ?8, folder = ?9, heartbeat_at = ?11
         WHERE id = ?10",
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
            job.manifest
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            serde_json::to_string(&job.relations)?,
            job.folder,
            id,
            job.heartbeat_at,
        ],
    )
    .map_err(|e| refused(&job, e))?;
    Ok(Some(job))
}

/// How long a runner may go without a heartbeat, and a `pending` job without
/// a runner, before the job is swept as abandoned. Published as
/// `x-keasy-bounds.job_lease_ms`; the browser's runner beats four times within
/// it, so one lost request is not an abandoned run.
pub const LEASE: std::time::Duration = std::time::Duration::from_secs(60);

/// End every job no runner is holding: `running` with a heartbeat (or, before
/// the first one, a start) older than [`LEASE`], and `pending` created longer
/// ago than it. Each becomes `failed` with the problem `job/abandoned`.
///
/// Run before every read of jobs rather than on a schedule: a tab that closed
/// cannot say so, and the next person to look is the only one who can notice.
pub fn sweep(conn: &Connection, now: jiff::Timestamp) -> DbResult<usize> {
    let spell = |t: jiff::Timestamp| t.strftime("%Y-%m-%dT%H:%M:%SZ").to_string();
    let cutoff = spell(now - jiff::SignedDuration::try_from(LEASE).expect("a lease fits"));
    let problem = serde_json::to_string(&ErrorBody::new(
        ErrorCode::Abandoned,
        format!(
            "Nothing ran this job for {} s: the tab that ran it closed, \
             or never opened it",
            LEASE.as_secs()
        ),
        Vec::new(),
    ))?;
    Ok(conn.execute(
        "UPDATE jobs SET status = 'failed', completed_at = ?1, problem = ?2
         WHERE (status = 'running' AND COALESCE(heartbeat_at, started_at, created_at) < ?3)
            OR (status = 'pending' AND created_at < ?3)",
        params![spell(now), problem, cutoff],
    )?)
}

/// Every job in the workspace (the owner's datasets view).
pub fn list(conn: &Connection) -> DbResult<Vec<Job>> {
    select(conn, "", None)
}

/// The jobs `user_id` created.
pub fn list_of(conn: &Connection, user_id: &str) -> DbResult<Vec<Job>> {
    select(conn, "WHERE created_by = ?1", Some(user_id))
}

fn select(conn: &Connection, filter: &str, param: Option<&str>) -> DbResult<Vec<Job>> {
    let jobs = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM jobs {filter} ORDER BY created_at DESC"
        ))?
        .query_map(rusqlite::params_from_iter(param), row_to_job)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(jobs)
}

/// Hand every job `from` holds to `to`; how many moved.
pub fn reassign(conn: &Connection, from: &str, to: &str) -> DbResult<usize> {
    Ok(conn.execute(
        "UPDATE jobs SET created_by = ?1 WHERE created_by = ?2",
        [to, from],
    )?)
}

pub fn delete(conn: &Connection, id: &str) -> DbResult<()> {
    conn.execute("DELETE FROM jobs WHERE id = ?1", [id])?;
    Ok(())
}

fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<Job> {
    let status: JobStatus = enum_column(row, "status")?;
    // The browser reads the program to run a `Pending` job (and to re-run a
    // `Running` one); a finished job exposes only its manifest.
    let script = match status {
        JobStatus::Draft | JobStatus::Pending | JobStatus::Running => row.get("script")?,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled => None,
    };
    Ok(Job {
        id: row.get("id")?,
        name: row.get("name")?,
        status,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        heartbeat_at: row.get("heartbeat_at")?,
        problem: json_column_opt(row, "problem")?,
        created_by: row.get("created_by")?,
        sink_connection: row.get("sink_connection")?,
        folder: row.get("folder")?,
        script,
        manifest: json_column_opt(row, "manifest")?,
        relations: json_column_opt(row, "relations")?.unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::JobFolder;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        crate::connections::persistence::tests::seed_sink(&conn, "sink");
        conn
    }

    fn job(owner: &str) -> Job {
        Job::new(
            JobStatus::Draft,
            None,
            "sink".into(),
            None,
            "x".into(),
            owner.into(),
        )
    }

    fn filed(status: JobStatus, folder: &str) -> Job {
        Job::new(
            status,
            None,
            "sink".into(),
            Some(JobFolder::parse(folder).unwrap()),
            "x".into(),
            "u-1".into(),
        )
    }

    /// One folder, one job's output: drafts may share it, and the folder is
    /// free again once its job is gone.
    #[test]
    fn a_folder_holds_one_jobs_output() {
        let conn = conn();
        insert(&conn, &filed(JobStatus::Draft, "people")).unwrap();
        insert(&conn, &filed(JobStatus::Draft, "people")).unwrap();
        let first = filed(JobStatus::Pending, "people");
        insert(&conn, &first).unwrap();

        let second = filed(JobStatus::Pending, "people");
        assert!(matches!(
            insert(&conn, &second),
            Err(DbError::AlreadyExists(_))
        ));
        insert(&conn, &filed(JobStatus::Pending, "orders")).unwrap();

        delete(&conn, &first.id).unwrap();
        insert(&conn, &second).unwrap();
    }

    /// Only a draft goes without a folder, and it cannot leave draft without one.
    #[test]
    fn only_a_draft_goes_without_a_folder() {
        let conn = conn();
        let mut pending = job("u-1");
        pending.status = JobStatus::Pending;
        assert!(matches!(insert(&conn, &pending), Err(DbError::Invalid(_))));

        let draft = job("u-1");
        insert(&conn, &draft).unwrap();
        let promoted = update(&conn, &draft.id, |j| j.status = JobStatus::Running);
        assert!(matches!(promoted, Err(DbError::Invalid(_))));
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

        conn.execute(
            "UPDATE jobs SET status = 'draft', relations = 'not json'",
            [],
        )
        .unwrap();
        assert!(get(&conn, &stored.id).is_err());
    }

    fn at(job: &Job, conn: &Connection) -> Job {
        get(conn, &job.id).unwrap().unwrap()
    }

    #[test]
    fn a_job_no_runner_holds_is_swept_to_failed_as_abandoned() {
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
        let mut orphan = filed(JobStatus::Pending, "orphan");
        orphan.created_at = ago(61);
        let fresh = filed(JobStatus::Pending, "fresh");
        let draft = job("u-1");
        for j in [&stale, &alive, &orphan, &fresh, &draft] {
            insert(&conn, j).unwrap();
        }

        assert_eq!(sweep(&conn, now).unwrap(), 2);

        for gone in [&stale, &orphan] {
            let read = at(gone, &conn);
            assert_eq!(read.status, JobStatus::Failed);
            assert_eq!(read.problem.as_ref().unwrap()["code"], "job/abandoned");
            assert!(read.completed_at.is_some());
        }
        assert_eq!(at(&alive, &conn).status, JobStatus::Running);
        assert_eq!(at(&fresh, &conn).status, JobStatus::Pending);
        assert_eq!(at(&draft, &conn).status, JobStatus::Draft);
        assert_eq!(sweep(&conn, now).unwrap(), 0, "a swept job is swept once");
    }
}
