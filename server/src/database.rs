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
use crate::domain::{Actor, Grant, Provenance};
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

/// The `grants` column a `SELECT` over `table` adds: the row's grants as one
/// JSON array, read by [`grants_column`]. `column` is the grants' column that
/// names the row, `key` the row's own.
pub(crate) fn grants_of(table: &str, column: &str, key: &str) -> String {
    format!(
        "(SELECT json_group_array(json_object(
             'principal', json_object('kind', principal_kind, 'id', principal,
                                      'name', principal_name),
             'relation', relation,
             'granted_by', json_object('id', created_by, 'name', created_by_name),
             'granted_at', created_at))
          FROM grants WHERE grants.{column} = {table}.{key}) AS grants"
    )
}

/// The `grants` column [`grants_of`] selects, managers first and then by name.
pub(crate) fn grants_column(row: &rusqlite::Row<'_>) -> rusqlite::Result<Vec<Grant>> {
    let mut grants: Vec<Grant> = json_column(row, "grants")?;
    grants.sort_by(|a, b| {
        (a.relation.as_ref(), &a.principal.name).cmp(&(b.relation.as_ref(), &b.principal.name))
    });
    Ok(grants)
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

-- Who besides its owner manages an object, and who uses a secret: one tuple a
-- row (Zanzibar's object, relation, principal), the object in exactly one of
-- three columns so each has its foreign key — a rename carries the grant
-- along, a delete takes it away.
CREATE TABLE grants (
    secret          TEXT REFERENCES credentials (name) ON UPDATE CASCADE ON DELETE CASCADE,
    connection      TEXT REFERENCES connections (name) ON UPDATE CASCADE ON DELETE CASCADE,
    graph           TEXT REFERENCES graphs (id) ON DELETE CASCADE,
    principal_kind  TEXT NOT NULL CHECK (principal_kind IN ('user', 'group')),
    -- A person's `sub` or a group's Keycloak id; its name as it was granted.
    principal       TEXT NOT NULL,
    principal_name  TEXT NOT NULL,
    -- 'user' uses a secret; nothing else is used by a grant.
    relation        TEXT NOT NULL
        CHECK (relation = 'manager' OR (relation = 'user' AND secret IS NOT NULL)),
    created_by      TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    CHECK ((secret IS NOT NULL) + (connection IS NOT NULL) + (graph IS NOT NULL) = 1)
);
-- A tuple once: the object's NULL columns read as '' so they compare equal.
CREATE UNIQUE INDEX grants_one_tuple ON grants (
    coalesce(secret, ''), coalesce(connection, ''), coalesce(graph, ''),
    principal_kind, principal, relation
);
CREATE INDEX grants_of_secret ON grants (secret) WHERE secret IS NOT NULL;
CREATE INDEX grants_of_connection ON grants (connection) WHERE connection IS NOT NULL;
CREATE INDEX grants_of_graph ON grants (graph) WHERE graph IS NOT NULL;
CREATE INDEX grants_to ON grants (principal_kind, principal);
";

/// The statements this schema adds to the one before it, by how each begins.
const ADDED: [&str; 6] = [
    "CREATE TABLE grants (",
    "CREATE UNIQUE INDEX grants_one_tuple",
    "CREATE INDEX grants_of_secret",
    "CREATE INDEX grants_of_connection",
    "CREATE INDEX grants_of_graph",
    "CREATE INDEX grants_to",
];

/// The statement of [`SCHEMA`] that begins `start`, through its `;`.
fn statement(start: &str) -> &'static str {
    let from = SCHEMA.find(start).expect("the schema holds the statement");
    let to = from + SCHEMA[from..].find(";\n").expect("a statement ends") + 1;
    &SCHEMA[from..to]
}

/// The schema before this one, as a fresh database of it would hold it: this
/// one without the grants.
fn previous_schema() -> String {
    ADDED.iter().fold(SCHEMA.to_string(), |schema, start| {
        schema.replace(statement(start), "")
    })
}

/// From the previous schema to this one: the grants, an empty table and its
/// indexes. Nothing else moves, so every row is kept as it is — owned, as
/// phase A left it, by who created it or by the workspace.
fn upgrade() -> String {
    let added: Vec<&str> = ADDED.iter().map(|start| statement(start)).collect();
    format!("BEGIN;\n{}\nCOMMIT;", added.join("\n"))
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
            let _ = conn.execute_batch("ROLLBACK;");
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
        tracing::info!("schema upgraded: objects can be shared");
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
    /// row is kept as it was, and the objects can be shared — a grant goes
    /// with its object's rename and dies with it.
    #[test]
    fn a_database_of_the_previous_schema_is_upgraded_with_its_rows() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(&previous_schema()).unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO credentials (name, spec, owner, owner_name, created_by, created_by_name, created_at)
                VALUES ('seed', x'00', 'workspace', 'Workspace', 'bootstrap', 'Bootstrap', 't'),
                       ('mine', x'00', 'u-1', 'Ana', 'u-1', 'Ana', 't');
            INSERT INTO connections (name, credential, target, owner, owner_name, created_by, created_by_name, created_at)
                VALUES ('sink', 'seed', '{"direction":"sink"}', 'workspace', 'Workspace', 'bootstrap', 'Bootstrap', 't');
            INSERT INTO graphs (id, status, created_at, owner, owner_name, created_by, created_by_name, sink_connection, folder)
                VALUES ('g', 'completed', 't', 'u-2', 'Bruno', 'u-2', 'Bruno', 'sink', 'people');
            "#,
        )
        .unwrap();

        apply_schema(&conn).unwrap();
        apply_schema(&conn).unwrap();

        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(count("SELECT count(*) FROM credentials"), 2);
        assert_eq!(count("SELECT count(*) FROM graphs WHERE owner = 'u-2'"), 1);
        conn.execute_batch(
            "INSERT INTO grants (secret, principal_kind, principal, principal_name, relation,
                                 created_by, created_by_name, created_at)
                 VALUES ('mine', 'group', 'g-1', 'Research', 'user', 'u-1', 'Ana', 't');
             INSERT INTO grants (graph, principal_kind, principal, principal_name, relation,
                                 created_by, created_by_name, created_at)
                 VALUES ('g', 'user', 'u-1', 'Ana', 'manager', 'u-2', 'Bruno', 't');
             UPDATE credentials SET name = 'ours' WHERE name = 'mine';
             DELETE FROM graphs WHERE id = 'g';",
        )
        .unwrap();
        assert_eq!(
            count("SELECT count(*) FROM grants WHERE secret = 'ours'"),
            1
        );
        assert_eq!(
            count("SELECT count(*) FROM grants"),
            1,
            "gone with its graph"
        );
    }

    /// One tuple, once; one object a row; and a user only of a secret.
    #[test]
    fn the_grants_table_holds_well_formed_tuples_only() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        apply_schema(&conn).unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO credentials (name, spec, owner, owner_name, created_by, created_by_name, created_at)
                VALUES ('s', x'00', 'u-1', 'Ana', 'u-1', 'Ana', 't');
            INSERT INTO connections (name, credential, target, owner, owner_name, created_by, created_by_name, created_at)
                VALUES ('c', 's', '{"direction":"source"}', 'u-1', 'Ana', 'u-1', 'Ana', 't');
            "#,
        )
        .unwrap();
        let grant = |object: &str, relation: &str| {
            conn.execute_batch(&format!(
                "INSERT INTO grants ({object}, principal_kind, principal, principal_name,
                                     relation, created_by, created_by_name, created_at)
                     VALUES ('{}', 'user', 'u-2', 'Bruno', '{relation}', 'u-1', 'Ana', 't')",
                if object == "secret" { "s" } else { "c" }
            ))
        };
        grant("secret", "user").unwrap();
        grant("secret", "manager").unwrap();
        grant("connection", "manager").unwrap();
        assert!(grant("secret", "user").is_err(), "a second of one tuple");
        assert!(
            grant("connection", "user").is_err(),
            "a connection is not used by a grant"
        );
        assert!(
            conn.execute_batch(
                "INSERT INTO grants (secret, connection, principal_kind, principal, principal_name,
                                     relation, created_by, created_by_name, created_at)
                     VALUES ('s', 'c', 'user', 'u-3', 'Caro', 'manager', 'u-1', 'Ana', 't')"
            )
            .is_err(),
            "two objects in one row"
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
