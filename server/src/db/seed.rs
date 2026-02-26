use rusqlite::Connection;

pub const SEED_ORG_ID: &str = "00000000-0000-0000-0000-000000000001";
pub const SEED_DATASPACE_ID: &str = "00000000-0000-0000-0000-000000000002";
pub const SEED_ADMIN_ID: &str = "00000000-0000-0000-0000-000000000003";
pub const SEED_ORG_DATASPACE_MEMBERSHIP_ID: &str = "00000000-0000-0000-0000-000000000004";
pub const SEED_USER_ORG_MEMBERSHIP_ID: &str = "00000000-0000-0000-0000-000000000005";
pub const SEED_ADMIN_EMAIL: &str = "admin@keasy.local";

/// Ensure seed data exists. Runs once at startup; idempotent via INSERT OR IGNORE with fixed IDs.
pub fn ensure_seed_data(conn: &Connection) -> Result<(), String> {
    let now = jiff::Timestamp::now().to_string();

    // Default organization (promotor)
    conn.execute(
        "INSERT OR IGNORE INTO organizations
         (id, name, legal_name, registration_number, country, created_at, updated_at)
         VALUES (?1, 'Keasy', 'Keasy Promotor Org', NULL, 'EU', ?2, ?2)",
        rusqlite::params![SEED_ORG_ID, now],
    )
    .map_err(|e| format!("seed org: {e}"))?;

    // Default dataspace
    conn.execute(
        "INSERT OR IGNORE INTO dataspaces (id, name, description, created_at, updated_at)
         VALUES (?1, 'Default Dataspace', 'Initial development dataspace', ?2, ?2)",
        rusqlite::params![SEED_DATASPACE_ID, now],
    )
    .map_err(|e| format!("seed dataspace: {e}"))?;

    // Org-to-dataspace membership (promotor) — fixed sentinel ID to avoid duplicates
    conn.execute(
        "INSERT OR IGNORE INTO org_dataspace_memberships
         (id, org_id, dataspace_id, role, created_at)
         VALUES (?1, ?2, ?3, 'promotor', ?4)",
        rusqlite::params![
            SEED_ORG_DATASPACE_MEMBERSHIP_ID,
            SEED_ORG_ID,
            SEED_DATASPACE_ID,
            now
        ],
    )
    .map_err(|e| format!("seed org-dataspace membership: {e}"))?;

    // Admin user (password = "changeme", hashed with argon2id)
    // compute_seed_hash runs synchronously at startup before tokio serves requests — blocking is acceptable.
    let password_hash = compute_seed_hash("changeme");
    conn.execute(
        "INSERT OR IGNORE INTO users
         (id, email, first_name, last_name, password_hash, status, created_at, updated_at)
         VALUES (?1, ?2, 'Admin', 'User', ?3, 'active', ?4, ?4)",
        rusqlite::params![SEED_ADMIN_ID, SEED_ADMIN_EMAIL, password_hash, now],
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

    Ok(())
}

fn compute_seed_hash(password: &str) -> String {
    use argon2::password_hash::{rand_core::OsRng, SaltString};
    use argon2::{Argon2, PasswordHasher};
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("seed password hash")
        .to_string()
}
