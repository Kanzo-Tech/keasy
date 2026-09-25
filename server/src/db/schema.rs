//! The instance database schema: one statement list, no migrations.
//!
//! A fresh database gets [`SCHEMA`]. An existing one must already hold exactly
//! what [`SCHEMA`] creates, or the server refuses to start: the schema changes
//! by deleting the data volume and rebuilding, never by migrating a live file.

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
pub fn apply(conn: &rusqlite::Connection) -> Result<(), String> {
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
        apply(&conn).unwrap();
        apply(&conn).unwrap();
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

        let err = apply(&conn).unwrap_err();
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
