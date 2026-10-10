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
use crate::domain::{Actor, Provenance};
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
    /// A second graph that is not a draft writing to one folder of the sink.
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
                ErrorCode::GraphFolderTaken,
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

/// Who created a row and when: `created_by`, `created_by_name`, `created_at`.
pub(crate) fn created_columns(row: &rusqlite::Row<'_>) -> rusqlite::Result<Provenance> {
    Ok(Provenance {
        created_by: Actor {
            id: row.get("created_by")?,
            name: row.get("created_by_name")?,
        },
        created_at: row.get("created_at")?,
        updated_by: None,
        updated_at: None,
    })
}

/// Who owns a row: `owner`, `owner_name`.
pub(crate) fn owner_columns(row: &rusqlite::Row<'_>) -> rusqlite::Result<Actor> {
    Ok(Actor {
        id: row.get("owner")?,
        name: row.get("owner_name")?,
    })
}

/// [`created_columns`], and who changed the row last and when, if anyone has.
pub(crate) fn provenance_columns(row: &rusqlite::Row<'_>) -> rusqlite::Result<Provenance> {
    let updated_by = match (
        row.get::<_, Option<String>>("updated_by")?,
        row.get::<_, Option<String>>("updated_by_name")?,
    ) {
        (Some(id), Some(name)) => Some(Actor { id, name }),
        _ => None,
    };
    Ok(Provenance {
        updated_by,
        updated_at: row.get("updated_at")?,
        ..created_columns(row)?
    })
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

// Who wrote a row is kept twice: `*_by` is the Keycloak `sub`, what
// authorization compares; `*_by_name` is what they were called when they wrote
// it, for people to read. `updated_*` stay NULL until a row is changed.
const SCHEMA: &str = "
-- The spec is sealed whole (AES-256-GCM, AAD = 'credential:' || name).
CREATE TABLE credentials (
    name            TEXT PRIMARY KEY,
    spec            BLOB NOT NULL,
    -- Who owns it: a `sub`, or 'workspace' for what the instance declares.
    -- What permissions read; who created it is kept apart, and never changes.
    owner           TEXT NOT NULL,
    owner_name      TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_by      TEXT,
    updated_by_name TEXT,
    updated_at      TEXT,
    validation      TEXT
);

-- RESTRICT keeps a credential in use from being deleted.
CREATE TABLE connections (
    name            TEXT PRIMARY KEY,
    credential      TEXT NOT NULL,
    target          TEXT NOT NULL CHECK (json_type(target) = 'object'),
    direction       TEXT GENERATED ALWAYS AS (json_extract(target, '$.direction')) VIRTUAL,
    -- Who owns it: a `sub`, or 'workspace' for what the instance declares.
    -- What permissions read; who created it is kept apart, and never changes.
    owner           TEXT NOT NULL,
    owner_name      TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_by      TEXT,
    updated_by_name TEXT,
    updated_at      TEXT,
    validation      TEXT,
    FOREIGN KEY (credential) REFERENCES credentials (name)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
-- Exactly one write sink per workspace.
CREATE UNIQUE INDEX connections_one_sink ON connections(direction) WHERE direction = 'sink';

CREATE TABLE graphs (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    -- The run's lease: taken by run and renewed by its runner; a running
    -- graph whose lease has lapsed is swept to failed.
    heartbeat_at    TEXT,
    -- Who runs the graph, or ran it last: the only one whose reports count.
    runner          TEXT CHECK (status <> 'running' OR runner IS NOT NULL),
    runner_name     TEXT CHECK ((runner IS NULL) = (runner_name IS NULL)),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
    problem         TEXT CHECK (problem IS NULL OR json_valid(problem)),
    -- Who owns it: a `sub`, or 'workspace' for what the instance declares.
    -- What permissions read; who created it is kept apart, and never changes.
    owner           TEXT NOT NULL,
    owner_name      TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    sink_connection TEXT NOT NULL REFERENCES connections (name)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    folder          TEXT CHECK (status = 'draft' OR folder IS NOT NULL),
    script          TEXT,
    -- fossil's run report, opaque. What the corpus holds, the corpus says.
    report          TEXT CHECK (report IS NULL OR json_valid(report))
);
-- A folder holds one graph's output: drafts may share one, nothing else does.
CREATE UNIQUE INDEX graphs_one_folder ON graphs(sink_connection, folder) WHERE status <> 'draft';

-- A graph's saved dashboard: opaque to keasy, gone with the graph.
CREATE TABLE dashboards (
    graph_id          TEXT PRIMARY KEY REFERENCES graphs (id) ON DELETE CASCADE,
    spec            TEXT NOT NULL CHECK (json_type(spec) = 'object'),
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_by      TEXT,
    updated_by_name TEXT,
    updated_at      TEXT
);

-- A graph's rules: one SHACL shapes graph, Turtle, and the name of the file
-- it was dropped as, opaque to keasy (rudof reads it in the browser), gone
-- with the graph.
CREATE TABLE rules (
    graph_id        TEXT PRIMARY KEY REFERENCES graphs (id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    shapes          TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_by      TEXT,
    updated_by_name TEXT,
    updated_at      TEXT
);
";

/// `credentials`, `connections` and `graphs` as the schema before this one
/// made them: without an owner.
const PREVIOUS: [&str; 3] = [
    "CREATE TABLE credentials (
    name            TEXT PRIMARY KEY,
    spec            BLOB NOT NULL,
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_by      TEXT,
    updated_by_name TEXT,
    updated_at      TEXT,
    validation      TEXT
);",
    "CREATE TABLE connections (
    name            TEXT PRIMARY KEY,
    credential      TEXT NOT NULL,
    target          TEXT NOT NULL CHECK (json_type(target) = 'object'),
    direction       TEXT GENERATED ALWAYS AS (json_extract(target, '$.direction')) VIRTUAL,
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_by      TEXT,
    updated_by_name TEXT,
    updated_at      TEXT,
    validation      TEXT,
    FOREIGN KEY (credential) REFERENCES credentials (name)
        ON UPDATE CASCADE ON DELETE RESTRICT
);",
    "CREATE TABLE graphs (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    -- The run's lease: taken by run and renewed by its runner; a running
    -- graph whose lease has lapsed is swept to failed.
    heartbeat_at    TEXT,
    -- Who runs the graph, or ran it last: the only one whose reports count.
    runner          TEXT CHECK (status <> 'running' OR runner IS NOT NULL),
    runner_name     TEXT CHECK ((runner IS NULL) = (runner_name IS NULL)),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
    problem         TEXT CHECK (problem IS NULL OR json_valid(problem)),
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    sink_connection TEXT NOT NULL REFERENCES connections (name)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    folder          TEXT CHECK (status = 'draft' OR folder IS NOT NULL),
    script          TEXT,
    -- fossil's run report, opaque. What the corpus holds, the corpus says.
    report          TEXT CHECK (report IS NULL OR json_valid(report))
);",
];

/// The statement of [`SCHEMA`] that begins `start`, through its `;`.
fn statement(start: &str) -> &'static str {
    let from = SCHEMA.find(start).expect("the schema holds the statement");
    let to = from + SCHEMA[from..].find(";\n").expect("a statement ends") + 1;
    &SCHEMA[from..to]
}

/// The tables [`PREVIOUS`] replaces, by the statement each begins with.
const OWNED: [&str; 3] = [
    "CREATE TABLE credentials (",
    "CREATE TABLE connections (",
    "CREATE TABLE graphs (",
];

/// The schema before this one, as a fresh database of it would hold it.
fn previous_schema() -> String {
    OWNED
        .iter()
        .zip(PREVIOUS)
        .fold(SCHEMA.to_string(), |schema, (start, previous)| {
            schema.replace(statement(start), previous)
        })
}

/// From the previous schema to this one: `credentials`, `connections` and
/// `graphs` gain an owner — whoever created each row, and the workspace for
/// what the bootstrap declared. The old tables are moved aside rather than the
/// new ones renamed into place, so each new statement is [`SCHEMA`]'s, word
/// for word; `legacy_alter_table` keeps the moves from rewriting the
/// references to them, and with foreign keys off the old tables go without
/// taking their dependents with them.
const UPGRADE: &str = "
PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
BEGIN;
DROP INDEX connections_one_sink;
DROP INDEX graphs_one_folder;
ALTER TABLE credentials RENAME TO credentials_previous;
ALTER TABLE connections RENAME TO connections_previous;
ALTER TABLE graphs RENAME TO graphs_previous;
{credentials}
{connections}
{one_sink}
{graphs}
{one_folder}
INSERT INTO credentials (name, spec, owner, owner_name, created_by, created_by_name, created_at,
                         updated_by, updated_by_name, updated_at, validation)
    SELECT name, spec, {owner}, {owner_name}, created_by, created_by_name, created_at,
           updated_by, updated_by_name, updated_at, validation
    FROM credentials_previous;
INSERT INTO connections (name, credential, target, owner, owner_name, created_by,
                         created_by_name, created_at, updated_by, updated_by_name, updated_at,
                         validation)
    SELECT name, credential, target, {owner}, {owner_name}, created_by,
           created_by_name, created_at, updated_by, updated_by_name, updated_at, validation
    FROM connections_previous;
INSERT INTO graphs (id, name, status, created_at, started_at, completed_at, heartbeat_at, runner,
                    runner_name, cancel_requested, problem, owner, owner_name, created_by,
                    created_by_name, sink_connection, folder, script, report)
    SELECT id, name, status, created_at, started_at, completed_at, heartbeat_at, runner,
           runner_name, cancel_requested, problem, {owner}, {owner_name}, created_by,
           created_by_name, sink_connection, folder, script, report
    FROM graphs_previous;
DROP TABLE graphs_previous;
DROP TABLE connections_previous;
DROP TABLE credentials_previous;
COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
";

/// [`UPGRADE`], its statements filled in from [`SCHEMA`] and its owner from
/// [`Actor::as_owner`]'s rule.
fn upgrade() -> String {
    let (bootstrap, workspace) = (Actor::bootstrap(), Actor::workspace());
    UPGRADE
        .replace("{credentials}", statement(OWNED[0]))
        .replace("{connections}", statement(OWNED[1]))
        .replace("{graphs}", statement(OWNED[2]))
        .replace(
            "{one_sink}",
            statement("CREATE UNIQUE INDEX connections_one_sink"),
        )
        .replace(
            "{one_folder}",
            statement("CREATE UNIQUE INDEX graphs_one_folder"),
        )
        .replace(
            "{owner_name}",
            &format!(
                "CASE created_by WHEN '{}' THEN '{}' ELSE created_by_name END",
                bootstrap.id, workspace.name
            ),
        )
        .replace(
            "{owner}",
            &format!(
                "CASE created_by WHEN '{}' THEN '{}' ELSE created_by END",
                bootstrap.id, workspace.id
            ),
        )
}

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
    if existing == expected {
        return Ok(());
    }
    if existing == objects_of(&previous_schema())? {
        if let Err(e) = conn.execute_batch(&upgrade()) {
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
        tracing::info!("schema upgraded: secrets, connections and graphs have an owner");
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
                 ('credentials','connections','graphs','dashboards','rules')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 5);
    }

    /// A database of the previous schema is brought forward in place: every
    /// row is kept, owned by who created it — what the bootstrap declared by
    /// the workspace — and a graph's dashboard survives its table's rebuild.
    #[test]
    fn a_database_of_the_previous_schema_is_upgraded_with_its_rows() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(&previous_schema()).unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO credentials (name, spec, created_by, created_by_name, created_at)
                VALUES ('seed', x'00', 'bootstrap', 'Bootstrap', 't'),
                       ('mine', x'00', 'u-1', 'Ana', 't');
            INSERT INTO connections (name, credential, target, created_by, created_by_name, created_at)
                VALUES ('sink', 'seed', '{"direction":"sink"}', 'bootstrap', 'Bootstrap', 't'),
                       ('data', 'mine', '{"direction":"source"}', 'u-1', 'Ana', 't');
            INSERT INTO graphs (id, status, created_at, created_by, created_by_name, sink_connection, folder)
                VALUES ('g', 'completed', 't', 'u-2', 'Bruno', 'sink', 'people');
            INSERT INTO dashboards (graph_id, spec, created_by, created_by_name, created_at)
                VALUES ('g', '{}', 'u-2', 'Bruno', 't');
            "#,
        )
        .unwrap();

        apply_schema(&conn).unwrap();
        apply_schema(&conn).unwrap();

        let owners = |table: &str| -> Vec<(String, String, String)> {
            conn.prepare(&format!(
                "SELECT owner, owner_name, created_by FROM {table} ORDER BY owner"
            ))
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
        };
        let row = |o: &str, n: &str, c: &str| (o.to_string(), n.to_string(), c.to_string());
        assert_eq!(
            owners("credentials"),
            [
                row("u-1", "Ana", "u-1"),
                row("workspace", "Workspace", "bootstrap")
            ],
            "who created it is kept apart from who owns it"
        );
        assert_eq!(
            owners("connections"),
            [
                row("u-1", "Ana", "u-1"),
                row("workspace", "Workspace", "bootstrap")
            ]
        );
        assert_eq!(owners("graphs"), [row("u-2", "Bruno", "u-2")]);
        let sinks: i64 = conn
            .query_row(
                "SELECT count(*) FROM connections WHERE direction = 'sink'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sinks, 1, "the generated column is computed again");
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1, "foreign keys are enforced again");
        conn.execute("DELETE FROM graphs WHERE id = 'g'", [])
            .unwrap();
        let dashboards: i64 = conn
            .query_row("SELECT count(*) FROM dashboards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(dashboards, 0, "a dashboard still dies with its graph");
        assert!(
            conn.execute("DELETE FROM credentials WHERE name = 'mine'", [])
                .is_err(),
            "a used credential is still kept"
        );
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
