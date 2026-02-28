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
         (id, name, legal_name, registration_number, country, role, created_at, updated_at)
         VALUES (?1, 'Keasy', 'Keasy Promotor Org', NULL, 'EU', 'promotor', ?2, ?2)",
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
