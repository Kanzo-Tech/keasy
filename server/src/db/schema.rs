const SCHEMA: &str = "
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

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

CREATE TABLE IF NOT EXISTS connectors (
    id               TEXT PRIMARY KEY,
    organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    connector_type   TEXT NOT NULL,
    direction        TEXT NOT NULL CHECK(direction IN ('source', 'destination', 'both')),
    config           TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    UNIQUE(organization_id, name)
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
    connector_ids   TEXT NOT NULL DEFAULT '[]',
    script          TEXT,
    rdf_base        TEXT,
    manifest        TEXT,
    catalog_manifest TEXT,
    catalog_base    TEXT
);

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

-- tower-sessions: HTTP session storage (replaces tower-sessions-rusqlite-store)
CREATE TABLE IF NOT EXISTS tower_sessions (
    id          TEXT PRIMARY KEY NOT NULL,
    data        BLOB NOT NULL,
    expiry_date INTEGER NOT NULL
);

";

pub fn apply(conn: &mut diesel::SqliteConnection) -> Result<(), String> {
    use diesel::connection::SimpleConnection;
    conn.batch_execute(SCHEMA)
        .map_err(|e| format!("schema creation failed: {e}"))
}
