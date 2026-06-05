const SCHEMA: &str = "
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Workspace membership and roles are Keycloak-native (client roles +
-- `keasy:role` claim) — there is no local members table. Workspace identity
-- lives in `settings`.

-- Resource tables. A single workspace per instance owns all data, so these
-- carry no organization scoping (W8 flatten).
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

";

pub fn apply(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("schema creation failed: {e}"))?;
    Ok(())
}
