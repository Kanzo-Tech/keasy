use rusqlite::params;

use super::Database;

#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub legal_name: String,
    pub registration_number: Option<String>,
    pub country_subdivision_code: Option<String>,
    pub registration_number_type: Option<String>,
    pub country: String,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    pub async fn create_organization(&self, org: &Organization) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO organizations
             (id, name, slug, legal_name, registration_number, country_subdivision_code, registration_number_type, country, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                org.id,
                org.name,
                org.slug,
                org.legal_name,
                org.registration_number,
                org.country_subdivision_code,
                org.registration_number_type,
                org.country,
                org.created_at,
                org.updated_at,
            ],
        )
        .map_err(|e| format!("failed to insert organization: {e}"))?;
        Ok(())
    }

    pub async fn get_organization(&self, id: &str) -> Option<Organization> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, slug, legal_name, registration_number, country_subdivision_code, registration_number_type, country, created_at, updated_at
             FROM organizations WHERE id = ?1",
            [id],
            row_to_org,
        )
        .ok()
    }

    /// Update an organization's identity fields.
    pub async fn update_org_identity(
        &self,
        org_id: &str,
        legal_name: &str,
        country: &str,
        registration_number: Option<&str>,
        country_subdivision_code: Option<&str>,
        registration_number_type: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.write().await;
        conn.execute(
            "UPDATE organizations SET legal_name = ?1, country = ?2, registration_number = ?3, country_subdivision_code = ?4, registration_number_type = ?5, updated_at = datetime('now') WHERE id = ?6",
            params![legal_name, country, registration_number, country_subdivision_code, registration_number_type, org_id],
        )?;
        Ok(())
    }

    /// Idempotently ensure the workspace row + the owner's membership exist
    /// (W7 control-plane bootstrap). This is the SINGLE bootstrap datum the
    /// instance derives from config (`owner_keycloak_sub`) — it replaces the old
    /// SQL seeds, fixed UUIDs, and the open invite token. Re-running is a no-op:
    /// the row is keyed by `workspace_id` (ON CONFLICT update), and the
    /// membership upsert is idempotent.
    ///
    /// The owner is stored as an `owner` member, so they resolve to
    /// `TenantRole::Owner` (see `middleware::tenant`). Profile fields fill in on
    /// first OIDC login.
    pub async fn ensure_owner_bootstrap(
        &self,
        owner_keycloak_sub: &str,
        workspace_id: &str,
        workspace_name: &str,
    ) -> Result<(), String> {
        {
            let conn = self.write().await;
            let slug = generate_unique_slug(&conn, workspace_name);
            conn.execute(
                "INSERT INTO organizations
                   (id, name, slug, legal_name, country, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?2, 'EU', datetime('now'), datetime('now'))
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   updated_at = datetime('now')",
                params![workspace_id, workspace_name, slug],
            )
            .map_err(|e| format!("failed to ensure owner org: {e}"))?;
        }
        self.upsert_org_member(owner_keycloak_sub, workspace_id, "owner", "", "", "")
            .await?;
        Ok(())
    }
}

fn row_to_org(row: &rusqlite::Row<'_>) -> rusqlite::Result<Organization> {
    Ok(Organization {
        id: row.get(0)?,
        name: row.get(1)?,
        slug: row.get(2)?,
        legal_name: row.get(3)?,
        registration_number: row.get(4)?,
        country_subdivision_code: row.get(5)?,
        registration_number_type: row.get(6)?,
        country: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

/// Generate a URL-safe slug from an organization name.
/// Lowercase, only [a-z0-9-], max 63 chars, no leading/trailing hyphens.
pub fn generate_slug(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let truncated = if slug.len() > 63 { &slug[..63] } else { &slug };
    truncated.trim_end_matches('-').to_string()
}

/// Generate a unique slug, appending a numeric suffix if the base slug is taken.
pub fn generate_unique_slug(conn: &rusqlite::Connection, name: &str) -> String {
    let base = generate_slug(name);
    if !slug_exists(conn, &base) {
        return base;
    }
    for i in 2..100 {
        let candidate = format!("{}-{}", base, i);
        if !slug_exists(conn, &candidate) {
            return candidate;
        }
    }
    // Fallback: use a random suffix
    format!("{}-{}", base, uuid::Uuid::new_v4().to_string().split('-').next().unwrap())
}

fn slug_exists(conn: &rusqlite::Connection, slug: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM organizations WHERE slug = ?1",
        [slug],
        |_| Ok(()),
    )
    .is_ok()
}
