use rusqlite::Connection;

pub const SEED_ORG_ID: &str = "00000000-0000-0000-0000-000000000001";
pub const SEED_ADMIN_ID: &str = "00000000-0000-0000-0000-000000000003";
pub const SEED_USER_ORG_MEMBERSHIP_ID: &str = "00000000-0000-0000-0000-000000000005";
pub const SEED_ADMIN_EMAIL: &str = "admin@keasy.local";
pub const SEED_INVITE_TOKEN: &str = "00000000000000000000000000000001";

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

    // Admin user — OIDC auth: no local password (empty password_hash).
    // The admin authenticates via Keycloak; local password hashing (Argon2id) is removed in Phase 11.
    conn.execute(
        "INSERT OR IGNORE INTO users
         (id, email, first_name, last_name, password_hash, status, created_at, updated_at)
         VALUES (?1, ?2, 'Admin', 'User', '', 'active', ?3, ?3)",
        rusqlite::params![SEED_ADMIN_ID, SEED_ADMIN_EMAIL, now],
    )
    .map_err(|e| format!("seed admin user: {e}"))?;

    // User-to-org membership (admin role) — fixed sentinel ID to avoid duplicates
    conn.execute(
        "INSERT OR IGNORE INTO user_org_memberships
         (id, user_id, org_id, role, created_at)
         VALUES (?1, ?2, ?3, 'admin', ?4)",
        rusqlite::params![
            SEED_USER_ORG_MEMBERSHIP_ID,
            SEED_ADMIN_ID,
            SEED_ORG_ID,
            now
        ],
    )
    .map_err(|e| format!("seed user-org membership: {e}"))?;

    // Bootstrap invite token — allows first additional user to register during development.
    // Expires 2099-12-31 (effectively never for dev). Role 'admin' so first invite can set up the org.
    conn.execute(
        "INSERT OR IGNORE INTO invite_tokens
         (token, email, org_id, role, created_by, used_at, expires_at, created_at)
         VALUES (?1, NULL, ?2, 'admin', ?3, NULL, '2099-12-31T00:00:00Z', ?4)",
        rusqlite::params![SEED_INVITE_TOKEN, SEED_ORG_ID, SEED_ADMIN_ID, now],
    )
    .map_err(|e| format!("seed invite token: {e}"))?;

    Ok(())
}
