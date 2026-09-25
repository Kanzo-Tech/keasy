mod schema;

pub(crate) use schema::apply as apply_schema;

use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::api::ErrorCode;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use tokio::sync::{Mutex, MutexGuard};

use crate::credentials::sealing::SecretKey;
use crate::error::fail;

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
        schema::apply(&write_conn)?;

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
