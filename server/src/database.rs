//! The instance database: one SQLite file, one writer and a few readers, and
//! its schema — one statement list.
//!
//! A fresh database gets the schema. An existing one must already hold exactly
//! what the schema creates, or the server refuses to start. The one exception
//! is the schema just before this one, which [`UPGRADE`] brings forward in
//! place, its rows kept; anything older is refused, and changes by deleting
//! the data volume. There is no chain of migrations: each change replaces the
//! previous upgrade with its own.

use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::StatusCode;
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use tokio::sync::{Mutex, MutexGuard};

use crate::credentials::sealing::SecretKey;
use crate::error::{ErrorCode, Refusal};

const READ_POOL_SIZE: usize = 4;

/// What reading or writing the instance database can fail with.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    /// The caller asked for something the data does not allow (a credential
    /// that does not exist).
    #[error("{0}")]
    Invalid(String),
    /// A second row of that name, or a second sink.
    #[error("{0}")]
    AlreadyExists(String),
    /// A second job that is not a draft writing to one folder of the sink.
    #[error("{0}")]
    FolderTaken(String),
    /// Still referenced by `dependents`.
    #[error("{message}")]
    InUse {
        message: String,
        dependents: Vec<String>,
    },
    #[error("database: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("stored JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("stored secret: {0}")]
    Secret(String),
}

pub type DbResult<T> = Result<T, DbError>;

impl From<DbError> for Refusal {
    fn from(e: DbError) -> Self {
        match e {
            DbError::Invalid(message) => Refusal::invalid(message),
            DbError::AlreadyExists(message) => {
                Refusal::conflict(ErrorCode::ResourceAlreadyExists, message)
            }
            DbError::FolderTaken(message) => Refusal::field(
                StatusCode::CONFLICT,
                ErrorCode::JobFolderTaken,
                "folder",
                message,
            ),
            DbError::InUse {
                message,
                dependents,
            } => Refusal::about(
                StatusCode::CONFLICT,
                ErrorCode::ResourceInUse,
                message,
                dependents,
            ),
            e => {
                tracing::error!(error = %e, "database failure");
                Refusal::internal()
            }
        }
    }
}

/// The extended code of a constraint the schema enforced
/// (`SQLITE_CONSTRAINT_FOREIGNKEY`, `…_UNIQUE`, …), when that is what failed.
pub(crate) fn constraint(e: &rusqlite::Error) -> Option<std::ffi::c_int> {
    match e {
        rusqlite::Error::SqliteFailure(err, _)
            if err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Some(err.extended_code)
        }
        _ => None,
    }
}

/// A JSON column, decoded strictly: a value that does not parse is an error
/// naming the column, never a default.
pub(crate) fn json_column<T: DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    column: &str,
) -> rusqlite::Result<T> {
    let text: String = row.get(column)?;
    serde_json::from_str(&text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            row.as_ref().column_index(column).unwrap_or(0),
            rusqlite::types::Type::Text,
            Box::new(e),
        )
    })
}

/// A nullable JSON column, decoded as strictly as [`json_column`].
pub(crate) fn json_column_opt<T: DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    column: &str,
) -> rusqlite::Result<Option<T>> {
    match row.get::<_, Option<String>>(column)? {
        None => Ok(None),
        Some(_) => json_column(row, column).map(Some),
    }
}

/// An enum stored as its wire spelling, decoded strictly.
pub(crate) fn enum_column<T: FromStr>(
    row: &rusqlite::Row<'_>,
    column: &str,
) -> rusqlite::Result<T> {
    let text: String = row.get(column)?;
    text.parse().map_err(|_| {
        rusqlite::Error::FromSqlConversionFailure(
            row.as_ref().column_index(column).unwrap_or(0),
            rusqlite::types::Type::Text,
            format!("unknown {column} {text:?}").into(),
        )
    })
}

#[derive(Clone)]
pub struct Database {
    write_conn: Arc<Mutex<Connection>>,
    read_conns: Arc<[Mutex<Connection>]>,
    next_read: Arc<AtomicUsize>,
    secret_key: SecretKey,
}

impl Database {
    pub fn open(path: &Path, secret_key: SecretKey) -> Result<Self, String> {
        let write_conn = open_conn(path)?;
        write_conn
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
            )
            .map_err(|e| format!("write conn pragmas: {e}"))?;
        apply_schema(&write_conn)?;

        let read_conns = (0..READ_POOL_SIZE)
            .map(|_| {
                let conn = open_conn(path)?;
                conn.execute_batch(
                    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA query_only=ON;",
                )
                .map_err(|e| format!("read conn pragmas: {e}"))?;
                Ok(Mutex::new(conn))
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(Self {
            write_conn: Arc::new(Mutex::new(write_conn)),
            read_conns: read_conns.into(),
            next_read: Arc::new(AtomicUsize::new(0)),
            secret_key,
        })
    }

    /// The one write connection.
    pub async fn write(&self) -> MutexGuard<'_, Connection> {
        self.write_conn.lock().await
    }

    pub fn secret_key(&self) -> &SecretKey {
        &self.secret_key
    }

    /// Whether the configured key opens the stored credentials; true when
    /// none is stored.
    pub async fn key_opens_credentials(&self) -> DbResult<bool> {
        crate::credentials::persistence::key_opens(&*self.read().await, &self.secret_key)
    }

    /// A free read connection, or — when all are busy — the next one in turn.
    pub async fn read(&self) -> MutexGuard<'_, Connection> {
        for conn in self.read_conns.iter() {
            if let Ok(guard) = conn.try_lock() {
                return guard;
            }
        }
        let turn = self.next_read.fetch_add(1, Ordering::Relaxed) % self.read_conns.len();
        self.read_conns[turn].lock().await
    }
}

fn open_conn(path: &Path) -> Result<Connection, String> {
    Connection::open(path).map_err(|e| format!("failed to open connection: {e}"))
}

const SCHEMA: &str = "
-- The spec is sealed whole (AES-256-GCM, AAD = 'credential:' || name).
CREATE TABLE credentials (
    name        TEXT PRIMARY KEY,
    spec        BLOB NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    validation  TEXT
);

-- RESTRICT keeps a credential in use from being deleted.
CREATE TABLE connections (
    name        TEXT PRIMARY KEY,
    credential  TEXT NOT NULL,
    target      TEXT NOT NULL CHECK (json_type(target) = 'object'),
    direction   TEXT GENERATED ALWAYS AS (json_extract(target, '$.direction')) VIRTUAL,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    validation  TEXT,
    FOREIGN KEY (credential) REFERENCES credentials (name)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
-- Exactly one write sink per workspace.
CREATE UNIQUE INDEX connections_one_sink ON connections(direction) WHERE direction = 'sink';

CREATE TABLE jobs (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    -- The runner's lease: refreshed while the job runs, and a running job
    -- whose heartbeat is older than the lease is swept to failed.
    heartbeat_at    TEXT,
    problem         TEXT CHECK (problem IS NULL OR json_valid(problem)),
    created_by      TEXT NOT NULL,
    sink_connection TEXT NOT NULL REFERENCES connections (name)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    folder          TEXT CHECK (status = 'draft' OR folder IS NOT NULL),
    script          TEXT,
    -- fossil's run report, opaque. What the corpus holds, the corpus says.
    report          TEXT CHECK (report IS NULL OR json_valid(report))
);
-- A folder holds one job's output: drafts may share one, nothing else does.
CREATE UNIQUE INDEX jobs_one_folder ON jobs(sink_connection, folder) WHERE status <> 'draft';

-- A job's saved dashboard: opaque to keasy, gone with the job.
CREATE TABLE dashboards (
    job_id      TEXT PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
    spec        TEXT NOT NULL CHECK (json_type(spec) = 'object'),
    updated_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL
);
";

/// The `jobs` table of the schema before this one: a copy of the corpus's own
/// description (`relations`), and the run report under the name `manifest`.
const PREVIOUS_JOBS: &str = "CREATE TABLE jobs (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    -- The runner's lease: refreshed while the job runs, and a running job
    -- whose heartbeat is older than the lease is swept to failed.
    heartbeat_at    TEXT,
    problem         TEXT CHECK (problem IS NULL OR json_valid(problem)),
    created_by      TEXT NOT NULL,
    sink_connection TEXT NOT NULL REFERENCES connections (name)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    folder          TEXT CHECK (status = 'draft' OR folder IS NOT NULL),
    script          TEXT,
    manifest        TEXT,
    relations       TEXT
);";

/// The statement of [`SCHEMA`] that begins `start`, through its `;`.
fn statement(start: &str) -> &'static str {
    let from = SCHEMA.find(start).expect("the schema holds the statement");
    let to = from + SCHEMA[from..].find(';').expect("a statement ends") + 1;
    &SCHEMA[from..to]
}

/// The schema before this one, as a fresh database of it would hold it.
fn previous_schema() -> String {
    SCHEMA.replace(statement("CREATE TABLE jobs ("), PREVIOUS_JOBS)
}

/// From the previous schema to this one: `jobs` is rebuilt without
/// `relations`, its `manifest` kept as `report`. The old table is moved aside
/// rather than the new one renamed into place, so the new one's statement is
/// [`SCHEMA`]'s, word for word; `legacy_alter_table` keeps the move from
/// rewriting `dashboards`' reference to `jobs`, and with foreign keys off the
/// old table goes without taking the dashboards with it.
const UPGRADE: &str = "
PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
BEGIN;
ALTER TABLE jobs RENAME TO jobs_previous;
{jobs}
INSERT INTO jobs (id, name, status, created_at, started_at, completed_at, heartbeat_at,
                  problem, created_by, sink_connection, folder, script, report)
    SELECT id, name, status, created_at, started_at, completed_at, heartbeat_at,
           problem, created_by, sink_connection, folder, script, manifest
    FROM jobs_previous;
DROP TABLE jobs_previous;
{index}
COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
";

/// Every table and index a fresh database of `schema` holds.
fn objects_of(schema: &str) -> Result<Vec<(String, String)>, String> {
    rusqlite::Connection::open_in_memory()
        .and_then(|fresh| {
            fresh.execute_batch(schema)?;
            objects(&fresh)
        })
        .map_err(|e| format!("build expected schema: {e}"))
}

/// Create the schema in an empty database, bring one of the previous schema
/// forward, or check that a non-empty one holds exactly it.
pub fn apply_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    let existing = objects(conn).map_err(|e| format!("read schema: {e}"))?;
    if existing.is_empty() {
        return conn
            .execute_batch(&format!("BEGIN; {SCHEMA} COMMIT;"))
            .map_err(|e| format!("create schema: {e}"));
    }

    let expected = objects_of(SCHEMA)?;
    if existing == objects_of(&previous_schema())? {
        let upgrade = UPGRADE
            .replace("{jobs}", statement("CREATE TABLE jobs ("))
            .replace("{index}", statement("CREATE UNIQUE INDEX jobs_one_folder"));
        if let Err(e) = conn.execute_batch(&upgrade) {
            // A failed statement leaves the transaction open; nothing of it is kept.
            let _ = conn
                .execute_batch("ROLLBACK; PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;");
            return Err(format!("upgrade the schema: {e}"));
        }
        let violations: i64 = conn
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .map_err(|e| format!("check the upgrade: {e}"))?;
        if violations > 0 {
            return Err(format!("the upgrade left {violations} broken references"));
        }
        tracing::info!("schema upgraded: jobs.relations dropped, jobs.manifest is jobs.report");
    }
    let existing = objects(conn).map_err(|e| format!("read schema: {e}"))?;
    if existing != expected {
        return Err(
            "the database was created by a different schema than this build's. \
             Schema changes are not migrated: delete the data volume (dev: \
             `docker compose down -v`) and start again"
                .into(),
        );
    }
    Ok(())
}

/// Every table and index the database defines, with the SQL that created it.
fn objects(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<(String, String)>> {
    conn.prepare(
        "SELECT name, sql FROM sqlite_master
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         ORDER BY name",
    )?
    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_database_gets_the_schema_and_accepts_it_again() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        apply_schema(&conn).unwrap();
        let tables: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN \
                 ('credentials','connections','jobs','dashboards')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 4);
    }

    /// A database of the previous schema is brought forward in place: its jobs
    /// keep their rows and their run report, the copy of the corpus's
    /// description goes, and a job's dashboard survives its table's rebuild.
    #[test]
    fn a_database_of_the_previous_schema_is_upgraded_with_its_rows() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(&previous_schema()).unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO credentials VALUES ('key', x'00', 'u', 't', 'u', 't', NULL);
            INSERT INTO connections (name, credential, target, created_by, created_at, updated_by, updated_at)
                VALUES ('sink', 'key', '{"direction":"sink"}', 'u', 't', 'u', 't');
            INSERT INTO jobs (id, status, created_at, created_by, sink_connection, folder, manifest, relations)
                VALUES ('done', 'completed', 't', 'u', 'sink', 'people', '{"dest":"s3://b/people/"}', '[{"name":"Person"}]'),
                       ('draft', 'draft', 't', 'u', 'sink', NULL, NULL, NULL);
            INSERT INTO dashboards VALUES ('done', '{"cards":[]}', 't', 'u');
            "#,
        )
        .unwrap();

        apply_schema(&conn).unwrap();
        apply_schema(&conn).unwrap();

        let report: String = conn
            .query_row("SELECT report FROM jobs WHERE id = 'done'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(report, r#"{"dest":"s3://b/people/"}"#);
        let jobs: i64 = conn
            .query_row("SELECT count(*) FROM jobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(jobs, 2);
        let dashboards: i64 = conn
            .query_row(
                "SELECT count(*) FROM dashboards WHERE job_id = 'done'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dashboards, 1, "the dashboard outlives the rebuild");
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1, "foreign keys are enforced again");
        conn.execute("DELETE FROM jobs WHERE id = 'done'", [])
            .unwrap();
        let dashboards: i64 = conn
            .query_row("SELECT count(*) FROM dashboards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(dashboards, 0, "and still dies with its job");
    }

    #[test]
    fn a_database_from_another_schema_is_refused_untouched() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE user_sessions (user_id TEXT PRIMARY KEY);")
            .unwrap();

        let err = apply_schema(&conn).unwrap_err();
        assert!(err.contains("delete the data volume"), "{err}");
        let kept: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 'user_sessions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kept, 1, "nothing is dropped on the way out");
    }
}
