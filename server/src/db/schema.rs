//! The instance database schema: one statement list, no migrations.
//!
//! A fresh database gets [`SCHEMA`]. An existing one must already hold exactly
//! what [`SCHEMA`] creates, or the server refuses to start: the schema changes
//! by deleting the data volume and rebuilding, never by migrating a live file.

const SCHEMA: &str = "
CREATE TABLE cloud_accounts (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    provider_id     TEXT NOT NULL,
    auth_method     TEXT,
    fields          TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE connections (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    kind             TEXT NOT NULL CHECK(kind IN ('data', 'vocab')),
    location_type    TEXT NOT NULL CHECK(location_type IN ('cloud', 'local')),
    direction        TEXT NOT NULL DEFAULT 'source' CHECK(direction IN ('source', 'sink')),
    cloud_account_id TEXT REFERENCES cloud_accounts(id) ON DELETE SET NULL,
    url              TEXT NOT NULL
);
-- Exactly one write sink per workspace.
CREATE UNIQUE INDEX connections_one_sink ON connections(direction) WHERE direction = 'sink';

CREATE TABLE jobs (
    id              TEXT PRIMARY KEY,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    mode            TEXT NOT NULL DEFAULT 'integrated',
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    error           TEXT,
    connection_ids  TEXT NOT NULL DEFAULT '[]',
    created_by      TEXT NOT NULL DEFAULT '',
    sink_connection_id TEXT,
    script          TEXT,
    manifest        TEXT,
    relations       TEXT
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE secrets (
    key   TEXT PRIMARY KEY,
    value BLOB NOT NULL
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
                 ('connections','jobs','settings','secrets','cloud_accounts')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 5);
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
