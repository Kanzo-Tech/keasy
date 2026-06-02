const SCHEMA: &str = "
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- New tenant entities
CREATE TABLE IF NOT EXISTS organizations (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    legal_name          TEXT NOT NULL,
    registration_number TEXT,
    country_subdivision_code TEXT,
    registration_number_type TEXT CHECK(registration_number_type IN ('vatID', 'leiCode', 'EORI')),
    country             TEXT NOT NULL CHECK(length(country) = 2),
    role                TEXT NOT NULL DEFAULT 'participant' CHECK(role IN ('promotor', 'participant')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_members (
    user_id    TEXT NOT NULL,
    org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    email      TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT '',
    last_name  TEXT NOT NULL DEFAULT '',
    joined_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, org_id)
);

-- Existing resource tables with organization_id NOT NULL FK
CREATE TABLE IF NOT EXISTS cloud_accounts (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    provider_id     TEXT NOT NULL,
    auth_method     TEXT,
    fields          TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS connections (
    id               TEXT PRIMARY KEY,
    organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL UNIQUE,
    kind             TEXT NOT NULL CHECK(kind IN ('data', 'vocab')),
    location_type    TEXT NOT NULL CHECK(location_type IN ('cloud', 'local')),
    cloud_account_id TEXT REFERENCES cloud_accounts(id) ON DELETE SET NULL,
    url              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    mode            TEXT NOT NULL DEFAULT 'integrated',
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    completed_at    TEXT,
    error           TEXT,
    connection_ids  TEXT NOT NULL DEFAULT '[]',
    script          TEXT,
    rdf_base        TEXT,
    manifest        TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_job_org ON conversations(job_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_jobs_org ON jobs(organization_id);

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

-- Invite tokens for invite-only registration (reusable, Slack-style)
CREATE TABLE IF NOT EXISTS invite_tokens (
    token      TEXT PRIMARY KEY,
    org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_by TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Gaia-X compliance state per org (replaces gaia_x_wizard_state)
-- Private key is NEVER stored — only public_key_jwk is persisted (locked decision)
-- did_document is NOT persisted: derived at runtime from public_key_jwk + domain
CREATE TABLE IF NOT EXISTS org_gaiax (
    org_id          TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    domain          TEXT,
    public_key_jwk  TEXT,
    cert_chain_pem  TEXT,
    root_ca_pem     TEXT,
    lrn_type        TEXT,
    lrn_value       TEXT,
    lrn_vc          TEXT,
    lp_vc           TEXT,
    tandc_vc        TEXT,
    compliance_vc   TEXT,
    wizard_step     INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL
);

-- Registered dataspace instances (OIDC clients in Keycloak)
-- Display metadata for workspace picker; OIDC credentials live in Keycloak only
CREATE TABLE IF NOT EXISTS dataspaces (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    description TEXT,
    logo        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
";

pub fn apply(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("schema creation failed: {e}"))?;

    // Incremental migrations for existing databases
    add_column_if_missing(conn, "jobs", "manifest", "TEXT");
    add_column_if_missing(conn, "jobs", "catalog_manifest", "TEXT");
    add_column_if_missing(conn, "jobs", "catalog_base", "TEXT");

    Ok(())
}

fn add_column_if_missing(conn: &rusqlite::Connection, table: &str, column: &str, col_type: &str) {
    let has_col = conn
        .prepare(&format!("SELECT {column} FROM {table} LIMIT 0"))
        .is_ok();
    if !has_col {
        let _ = conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {col_type}"));
    }
}
