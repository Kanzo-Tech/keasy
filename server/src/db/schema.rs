//! Versioned schema migrations.
//!
//! Each instance owns its own SQLite file. `PRAGMA user_version` records how many
//! migrations have run; [`apply`] runs every migration past the current version,
//! each in its own transaction, then bumps the version. Migration v1 is the
//! idempotent baseline (`CREATE TABLE IF NOT EXISTS`), so an instance created
//! before versioning — tables already present but `user_version = 0` — advances to
//! v1 without touching data.
//!
//! To evolve the schema, APPEND a migration to `MIGRATIONS` (`ALTER TABLE`, new
//! tables, backfills). NEVER edit a shipped migration — that desyncs already-migrated
//! instances. Connection-level pragmas (WAL, foreign_keys, …) live in [`super`] and
//! run on every open, so migrations stay pure DDL and can run inside a transaction.

/// Ordered DDL steps. `MIGRATIONS[i]` migrates the DB from `user_version` `i` to
/// `i + 1`. Append-only.
const MIGRATIONS: &[&str] = &[
    // ── v1 — baseline ──────────────────────────────────────────────────────
    // Workspace membership and roles are Keycloak-native (client roles +
    // `keasy:role` claim) — there is no local members table. Workspace identity
    // lives in `settings`. A single workspace per instance owns all data, so the
    // resource tables carry no organization scoping (W8 flatten).
    "
    CREATE TABLE IF NOT EXISTS cloud_accounts (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        provider_id     TEXT NOT NULL,
        auth_method     TEXT,
        fields          TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS connections (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL UNIQUE,
        kind             TEXT NOT NULL CHECK(kind IN ('data', 'vocab')),
        location_type    TEXT NOT NULL CHECK(location_type IN ('cloud', 'local')),
        direction        TEXT NOT NULL DEFAULT 'source' CHECK(direction IN ('source', 'sink')),
        cloud_account_id TEXT REFERENCES cloud_accounts(id) ON DELETE SET NULL,
        url              TEXT NOT NULL
    );
    -- Exactly one write sink per workspace (the owner output store).
    CREATE UNIQUE INDEX IF NOT EXISTS connections_one_sink
        ON connections(direction) WHERE direction = 'sink';

    CREATE TABLE IF NOT EXISTS jobs (
        id              TEXT PRIMARY KEY,
        name            TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        mode            TEXT NOT NULL DEFAULT 'integrated',
        created_at      TEXT NOT NULL,
        started_at      TEXT,
        completed_at    TEXT,
        error           TEXT,
        connection_ids  TEXT NOT NULL DEFAULT '[]',
        script          TEXT,
        manifest        TEXT,
        catalog_manifest TEXT
    );

    CREATE TABLE IF NOT EXISTS conversations (
        id              TEXT PRIMARY KEY,
        job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        created_at      TEXT NOT NULL,
        title           TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        sql             TEXT,
        data            TEXT,
        code            TEXT,
        explanation     TEXT,
        created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_job ON conversations(job_id);

    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secrets (
        key   TEXT PRIMARY KEY,
        value BLOB NOT NULL
    );

    -- Session-auth lookup: enforces single active session per user
    CREATE TABLE IF NOT EXISTS user_sessions (
        user_id    TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    -- Invite tokens for invite-only registration (reusable link, Discord-style).
    -- Joining via a link always grants `member`; the owner is bootstrapped.
    CREATE TABLE IF NOT EXISTS invite_tokens (
        token      TEXT PRIMARY KEY,
        created_by TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    ",
];

/// The schema version this binary expects — the count of known migrations. A DB
/// whose `user_version` exceeds this was written by a newer binary; [`apply`]
/// refuses to run against it rather than corrupt a forward-incompatible schema
/// (e.g. a rollout/rollback that lands an older image on a newer instance DB).
pub const SCHEMA_VERSION: u32 = MIGRATIONS.len() as u32;

/// Run every migration past the DB's current `user_version`, each transactionally,
/// then record the new version. Idempotent: re-running on an up-to-date DB is a no-op.
pub fn apply(conn: &rusqlite::Connection) -> Result<(), String> {
    let current: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .map_err(|e| format!("read user_version: {e}"))? as u32;

    if current > SCHEMA_VERSION {
        return Err(format!(
            "database schema is v{current}, newer than this binary's v{SCHEMA_VERSION} — \
             refusing to start (deploy a build at v{current} or newer)"
        ));
    }

    for (idx, migration) in MIGRATIONS.iter().enumerate() {
        let target = idx as u32 + 1;
        if current >= target {
            continue;
        }
        // Explicit BEGIN/COMMIT so the DDL + the version bump land atomically:
        // a failed migration rolls back and `user_version` stays put.
        conn.execute_batch(&format!(
            "BEGIN; {migration}\nPRAGMA user_version = {target}; COMMIT;"
        ))
        .map_err(|e| format!("migration to v{target} failed: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_db_migrates_to_latest() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        apply(&conn).unwrap();
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v as u32, SCHEMA_VERSION);
        // Core tables exist.
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN \
                 ('connections','jobs','settings','secrets','invite_tokens')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 5);
    }

    #[test]
    fn apply_is_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        apply(&conn).unwrap();
        apply(&conn).unwrap(); // second run: no-op, no error
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v as u32, SCHEMA_VERSION);
    }

    #[test]
    fn pre_versioning_db_advances_without_data_loss() {
        // Simulate an instance created before versioning: baseline applied, a row
        // written, but user_version still 0.
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('workspace_name', 'acme')",
            [],
        )
        .unwrap();
        let v0: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v0, 0);

        apply(&conn).unwrap();

        let v1: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v1 as u32, SCHEMA_VERSION);
        let val: String = conn
            .query_row("SELECT value FROM settings WHERE key='workspace_name'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(val, "acme"); // data preserved
    }

    #[test]
    fn newer_db_is_refused() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(&format!("PRAGMA user_version = {}", SCHEMA_VERSION + 1))
            .unwrap();
        assert!(apply(&conn).is_err());
    }
}
