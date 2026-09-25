//! The instance database: one SQLite file, one writer and a few readers, and
//! its schema — one statement list, no migrations.
//!
//! A fresh database gets the schema. An existing one must already hold exactly
//! what the schema creates, or the server refuses to start: the schema changes
//! by deleting the data volume and rebuilding, never by migrating a live file.

use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use tokio::sync::{Mutex, MutexGuard};

use crate::credentials::sealing::SecretKey;
use crate::error::{ErrorCode, fail};

const READ_POOL_SIZE: usize = 4;

/// What reading or writing the instance database can fail with.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    /// The caller asked for something the data does not allow (a credential
    /// that does not exist, or of the other purpose).
    #[error("{0}")]
    Invalid(String),
    /// A second row of that name, or a second sink.
    #[error("{0}")]
    AlreadyExists(String),
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

impl IntoResponse for DbError {
    fn into_response(self) -> Response {
        match self {
            DbError::Invalid(message) => fail(
                StatusCode::BAD_REQUEST,
                ErrorCode::ValidationFailed,
                message,
            ),
            DbError::AlreadyExists(message) => {
                fail(StatusCode::CONFLICT, ErrorCode::AlreadyExists, message)
            }
            DbError::InUse {
                message,
                dependents,
            } => crate::error::fail_about(
                StatusCode::CONFLICT,
                ErrorCode::InUse,
                message,
                dependents,
            ),
            e => {
                tracing::error!(error = %e, "database failure");
                fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ErrorCode::InternalError,
                    "An internal error occurred",
                )
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

    pub(crate) fn secret_key(&self) -> &SecretKey {
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
    purpose     TEXT NOT NULL CHECK (purpose IN ('storage', 'model')),
    spec        BLOB NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    validation  TEXT,
    UNIQUE (name, purpose)
);

-- The composite key keeps a storage connection off a model credential, and
-- RESTRICT keeps a credential in use from being deleted.
CREATE TABLE connections (
    name        TEXT PRIMARY KEY,
    purpose     TEXT NOT NULL CHECK (purpose IN ('storage', 'model')),
    credential  TEXT NOT NULL,
    target      TEXT NOT NULL CHECK (json_type(target, '$.' || purpose) = 'object'),
    direction   TEXT GENERATED ALWAYS AS (json_extract(target, '$.storage.direction')) VIRTUAL,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    validation  TEXT,
    FOREIGN KEY (credential, purpose) REFERENCES credentials (name, purpose)
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
    error           TEXT,
    created_by      TEXT NOT NULL,
    sink_connection TEXT NOT NULL REFERENCES connections (name)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    script          TEXT,
    manifest        TEXT,
    relations       TEXT
);
";

/// Create the schema in an empty database, or check that a non-empty one holds
/// exactly it.
pub fn apply_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    let existing = objects(conn).map_err(|e| format!("read schema: {e}"))?;
    if existing.is_empty() {
        return conn
            .execute_batch(&format!("BEGIN; {SCHEMA} COMMIT;"))
            .map_err(|e| format!("create schema: {e}"));
    }

    let expected = rusqlite::Connection::open_in_memory()
        .and_then(|fresh| {
            fresh.execute_batch(SCHEMA)?;
            objects(&fresh)
        })
        .map_err(|e| format!("build expected schema: {e}"))?;
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
                 ('credentials','connections','jobs')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 3);
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
