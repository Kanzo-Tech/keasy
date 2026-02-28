const SCHEMA: &str = "
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- New tenant entities
CREATE TABLE IF NOT EXISTS organizations (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    legal_name          TEXT NOT NULL,
    registration_number TEXT,
    country             TEXT NOT NULL CHECK(length(country) = 2),
    role                TEXT NOT NULL DEFAULT 'participant' CHECK(role IN ('promotor', 'participant')),
    vc_verified_at      TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id                  TEXT PRIMARY KEY,
    email               TEXT NOT NULL UNIQUE,
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    password_hash       TEXT NOT NULL,
    vc_holder_did       TEXT UNIQUE,
    subject             TEXT UNIQUE,
    wallet_connected_at TEXT,
    status              TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

-- User-to-org membership (role = admin or user)
CREATE TABLE IF NOT EXISTS user_org_memberships (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    created_at TEXT NOT NULL,
    UNIQUE(user_id, org_id)
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
    pipeline        TEXT NOT NULL DEFAULT '{\"inputs\":[],\"operations\":[],\"outputs\":[]}',
    catalog         TEXT,
    connection_ids  TEXT NOT NULL DEFAULT '[]',
    script          TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL,
    title           TEXT
);

-- Unchanged tables
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    sparql          TEXT,
    data            TEXT,
    code            TEXT,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

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
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Invite tokens for invite-only registration
CREATE TABLE IF NOT EXISTS invite_tokens (
    token      TEXT PRIMARY KEY,
    email      TEXT,
    org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_by TEXT NOT NULL REFERENCES users(id),
    used_at    TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Gaia-X compliance wizard state (per-org, auto-saved)
-- Private key is NEVER stored — only public_key_jwk is persisted (locked decision)
CREATE TABLE IF NOT EXISTS gaia_x_wizard_state (
    org_id          TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    current_step    INTEGER NOT NULL DEFAULT 0,
    public_key_jwk  TEXT,
    cert_chain_pem  TEXT,
    root_ca_pem     TEXT,
    did_document    TEXT,
    lrn_credential  TEXT,
    lp_credential   TEXT,
    tc_credential   TEXT,
    compliance_vc   TEXT,
    lrn_type        TEXT,
    lrn_value       TEXT,
    legal_name      TEXT,
    country_code    TEXT,
    domain          TEXT,
    updated_at      TEXT NOT NULL
);

-- Registered dataspace instances (OIDC clients in Keycloak)
-- Display metadata for workspace picker; OIDC credentials live in Keycloak only
CREATE TABLE IF NOT EXISTS oidc_clients (
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
    Ok(())
}
