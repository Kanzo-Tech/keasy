use rusqlite::Connection;

pub const SEED_ORG_ID: &str = "00000000-0000-0000-0000-000000000001";
pub const SEED_INVITE_TOKEN: &str = "00000000000000000000000000000001";

/// System user — exists only to satisfy the FK on bootstrap invite token.
/// Not a real user; cannot authenticate (no subject, no password).
const SYSTEM_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

/// Ensure seed data exists. Runs once at startup; idempotent via INSERT OR IGNORE with fixed IDs.
pub fn ensure_seed_data(conn: &Connection) -> Result<(), String> {
    let now = jiff::Timestamp::now().to_string();

    // Default organization (promotor)
    conn.execute(
        "INSERT OR IGNORE INTO organizations
         (id, name, slug, legal_name, registration_number, country, role, created_at, updated_at)
         VALUES (?1, 'Keasy', 'keasy', 'Keasy Promotor Org', NULL, 'EU', 'promotor', ?2, ?2)",
        rusqlite::params![SEED_ORG_ID, now],
    )
    .map_err(|e| format!("seed org: {e}"))?;

    // System user — placeholder to satisfy FK on the bootstrap invite token.
    // Cannot log in: no Keycloak subject, no password, status inactive.
    conn.execute(
        "INSERT OR IGNORE INTO users
         (id, email, first_name, last_name, password_hash, status, created_at, updated_at)
         VALUES (?1, 'system@keasy.local', 'System', '', '', 'inactive', ?2, ?2)",
        rusqlite::params![SYSTEM_USER_ID, now],
    )
    .map_err(|e| format!("seed system user: {e}"))?;

    // Bootstrap invite token — allows the first user to register via Keycloak and
    // join the promotor org as admin. Open (email=NULL), expires 2099.
    conn.execute(
        "INSERT OR IGNORE INTO invite_tokens
         (token, email, org_id, role, created_by, used_at, expires_at, created_at)
         VALUES (?1, NULL, ?2, 'admin', ?3, NULL, '2099-12-31T00:00:00Z', ?4)",
        rusqlite::params![SEED_INVITE_TOKEN, SEED_ORG_ID, SYSTEM_USER_ID, now],
    )
    .map_err(|e| format!("seed invite token: {e}"))?;

    Ok(())
}

// ── Dev seed: demo data for development ─────────────────────────────────────

// Keycloak user UUIDs (must match realm-import/keasy-realm.json)
const KC_ADMIN_SUBJECT: &str = "aaaaaaaa-0000-0000-0000-000000000001";
const KC_USER_SUBJECT: &str = "aaaaaaaa-0000-0000-0000-000000000002";

// Application user IDs
const DEV_ADMIN_ID: &str = "bbbbbbbb-0000-0000-0000-000000000001";
const DEV_USER_ID: &str = "bbbbbbbb-0000-0000-0000-000000000002";

// Participant org
const DEV_PARTICIPANT_ORG_ID: &str = "cccccccc-0000-0000-0000-000000000001";

// Cloud accounts
const DEV_CLOUD_AWS_ID: &str = "dddddddd-0000-0000-0000-000000000001";
const DEV_CLOUD_GCP_ID: &str = "dddddddd-0000-0000-0000-000000000002";

// Connections
const DEV_CONN_PRODUCTS_ID: &str = "eeeeeeee-0000-0000-0000-000000000001";
const DEV_CONN_SCHEMA_ID: &str = "eeeeeeee-0000-0000-0000-000000000002";
const DEV_CONN_CUSTOMER_ID: &str = "eeeeeeee-0000-0000-0000-000000000003";

// Jobs
const DEV_JOB_COMPLETED_ID: &str = "ffffffff-0000-0000-0000-000000000001";
const DEV_JOB_DRAFT_ID: &str = "ffffffff-0000-0000-0000-000000000002";
const DEV_JOB_FAILED_ID: &str = "ffffffff-0000-0000-0000-000000000003";

// Membership IDs
const DEV_MEMBERSHIP_ADMIN_ID: &str = "11111111-0000-0000-0000-000000000001";
const DEV_MEMBERSHIP_USER_ID: &str = "11111111-0000-0000-0000-000000000002";

/// Create demo data for development. Idempotent via INSERT OR IGNORE with fixed IDs.
/// Called when KEASY_DEV_SEED=true.
pub fn ensure_dev_seed(conn: &Connection) -> Result<(), String> {
    let now = jiff::Timestamp::now().to_string();

    // ── Users ────────────────────────────────────────────────────────────────
    conn.execute(
        "INSERT OR IGNORE INTO users
         (id, email, first_name, last_name, password_hash, subject, status, created_at, updated_at)
         VALUES (?1, 'admin@keasy.dev', 'Ada', 'Lovelace', '', ?2, 'active', ?3, ?3)",
        rusqlite::params![DEV_ADMIN_ID, KC_ADMIN_SUBJECT, now],
    )
    .map_err(|e| format!("dev seed admin user: {e}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO users
         (id, email, first_name, last_name, password_hash, subject, status, created_at, updated_at)
         VALUES (?1, 'user@keasy.dev', 'Alan', 'Turing', '', ?2, 'active', ?3, ?3)",
        rusqlite::params![DEV_USER_ID, KC_USER_SUBJECT, now],
    )
    .map_err(|e| format!("dev seed user: {e}"))?;

    // ── Participant organization ─────────────────────────────────────────────
    conn.execute(
        "INSERT OR IGNORE INTO organizations
         (id, name, slug, legal_name, registration_number, country, role, created_at, updated_at)
         VALUES (?1, 'ACME Corp', 'acme-corp', 'ACME Corporation GmbH', NULL, 'DE', 'participant', ?2, ?2)",
        rusqlite::params![DEV_PARTICIPANT_ORG_ID, now],
    )
    .map_err(|e| format!("dev seed participant org: {e}"))?;

    // ── Memberships ──────────────────────────────────────────────────────────
    // admin → promotor org (admin role)
    conn.execute(
        "INSERT OR IGNORE INTO user_org_memberships
         (id, user_id, org_id, role, created_at)
         VALUES (?1, ?2, ?3, 'admin', ?4)",
        rusqlite::params![DEV_MEMBERSHIP_ADMIN_ID, DEV_ADMIN_ID, SEED_ORG_ID, now],
    )
    .map_err(|e| format!("dev seed admin membership: {e}"))?;

    // user → ACME Corp (admin role)
    conn.execute(
        "INSERT OR IGNORE INTO user_org_memberships
         (id, user_id, org_id, role, created_at)
         VALUES (?1, ?2, ?3, 'admin', ?4)",
        rusqlite::params![DEV_MEMBERSHIP_USER_ID, DEV_USER_ID, DEV_PARTICIPANT_ORG_ID, now],
    )
    .map_err(|e| format!("dev seed user membership: {e}"))?;

    // ── Cloud accounts ───────────────────────────────────────────────────────
    conn.execute(
        "INSERT OR IGNORE INTO cloud_accounts
         (id, organization_id, name, provider_id, fields)
         VALUES (?1, ?2, 'AWS Production', 's3', '{\"region\":\"eu-west-1\"}')",
        rusqlite::params![DEV_CLOUD_AWS_ID, SEED_ORG_ID],
    )
    .map_err(|e| format!("dev seed AWS cloud account: {e}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO cloud_accounts
         (id, organization_id, name, provider_id, fields)
         VALUES (?1, ?2, 'Google Cloud Dev', 'gcp', '{\"project\":\"acme-dev\"}')",
        rusqlite::params![DEV_CLOUD_GCP_ID, DEV_PARTICIPANT_ORG_ID],
    )
    .map_err(|e| format!("dev seed GCP cloud account: {e}"))?;

    // ── Connections ──────────────────────────────────────────────────────────
    conn.execute(
        "INSERT OR IGNORE INTO connections
         (id, organization_id, name, kind, location_type, url)
         VALUES (?1, ?2, 'Product Catalog', 'data', 'local', 'file:///sample/products.csv')",
        rusqlite::params![DEV_CONN_PRODUCTS_ID, SEED_ORG_ID],
    )
    .map_err(|e| format!("dev seed product connection: {e}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO connections
         (id, organization_id, name, kind, location_type, url)
         VALUES (?1, ?2, 'Schema.org Vocab', 'vocab', 'local', 'https://schema.org')",
        rusqlite::params![DEV_CONN_SCHEMA_ID, SEED_ORG_ID],
    )
    .map_err(|e| format!("dev seed schema connection: {e}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO connections
         (id, organization_id, name, kind, location_type, cloud_account_id, url)
         VALUES (?1, ?2, 'Customer Data', 'data', 'cloud', ?3, 'gs://acme-dev/customers/')",
        rusqlite::params![DEV_CONN_CUSTOMER_ID, DEV_PARTICIPANT_ORG_ID, DEV_CLOUD_GCP_ID],
    )
    .map_err(|e| format!("dev seed customer connection: {e}"))?;

    // ── Jobs ─────────────────────────────────────────────────────────────────
    let pipeline_json = r#"{"inputs":[{"connection":"Product Catalog"}],"operations":[{"type":"map","field":"name"}],"outputs":[{"format":"turtle"}]}"#;

    conn.execute(
        "INSERT OR IGNORE INTO jobs
         (id, organization_id, name, status, created_at, started_at, completed_at, pipeline)
         VALUES (?1, ?2, 'Product ETL', 'completed', ?3, ?3, ?3, ?4)",
        rusqlite::params![DEV_JOB_COMPLETED_ID, SEED_ORG_ID, now, pipeline_json],
    )
    .map_err(|e| format!("dev seed completed job: {e}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO jobs
         (id, organization_id, name, status, created_at)
         VALUES (?1, ?2, 'Monthly Report', 'draft', ?3)",
        rusqlite::params![DEV_JOB_DRAFT_ID, DEV_PARTICIPANT_ORG_ID, now],
    )
    .map_err(|e| format!("dev seed draft job: {e}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO jobs
         (id, organization_id, name, status, created_at, started_at, error)
         VALUES (?1, ?2, 'Failed Import', 'failed', ?3, ?3, 'Connection timeout: unable to reach gs://acme-dev/customers/')",
        rusqlite::params![DEV_JOB_FAILED_ID, DEV_PARTICIPANT_ORG_ID, now],
    )
    .map_err(|e| format!("dev seed failed job: {e}"))?;

    Ok(())
}
