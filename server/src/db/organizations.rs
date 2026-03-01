use rusqlite::params;

use super::Database;

#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub legal_name: String,
    pub registration_number: Option<String>,
    pub country: String,
    pub role: String,
    pub vc_verified_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// An organization's role within the instance (promotor or participant).
#[derive(Debug, Clone, PartialEq)]
pub enum OrgRole {
    Admin,
    User,
}

impl OrgRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            OrgRole::Admin => "admin",
            OrgRole::User => "user",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "user" => OrgRole::User,
            _ => OrgRole::Admin,
        }
    }
}

#[derive(Debug, Clone)]
pub struct UserOrgMembership {
    pub id: String,
    pub user_id: String,
    pub org_id: String,
    pub role: OrgRole,
    pub created_at: String,
}

impl Database {
    pub async fn create_organization(&self, org: &Organization) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO organizations
             (id, name, slug, legal_name, registration_number, country, role, vc_verified_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                org.id,
                org.name,
                org.slug,
                org.legal_name,
                org.registration_number,
                org.country,
                org.role,
                org.vc_verified_at,
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
            "SELECT id, name, slug, legal_name, registration_number, country, role, vc_verified_at, created_at, updated_at
             FROM organizations WHERE id = ?1",
            [id],
            row_to_org,
        )
        .ok()
    }

    /// Update an organization's vc_verified_at timestamp to now.
    pub async fn update_org_vc_verified_at(&self, org_id: &str) -> Result<(), rusqlite::Error> {
        let conn = self.write().await;
        conn.execute(
            "UPDATE organizations SET vc_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
            [org_id],
        )?;
        Ok(())
    }

    /// Update an organization's identity fields (legal_name, country, registration_number).
    pub async fn update_org_identity(
        &self,
        org_id: &str,
        legal_name: &str,
        country: &str,
        registration_number: Option<&str>,
    ) -> Result<(), rusqlite::Error> {
        let conn = self.write().await;
        conn.execute(
            "UPDATE organizations SET legal_name = ?1, country = ?2, registration_number = ?3, updated_at = datetime('now') WHERE id = ?4",
            params![legal_name, country, registration_number, org_id],
        )?;
        Ok(())
    }

    pub async fn list_organizations(&self) -> Vec<Organization> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, slug, legal_name, registration_number, country, role, vc_verified_at, created_at, updated_at
                 FROM organizations ORDER BY name",
            )
            .expect("prepare list organizations");
        stmt.query_map([], row_to_org)
            .expect("query organizations")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn get_organization_by_slug(&self, slug: &str) -> Option<Organization> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, slug, legal_name, registration_number, country, role, vc_verified_at, created_at, updated_at
             FROM organizations WHERE slug = ?1",
            [slug],
            row_to_org,
        )
        .ok()
    }

    /// Returns the org membership for a user. One user belongs to exactly one org.
    pub async fn get_user_org_membership(&self, user_id: &str) -> Option<UserOrgMembership> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, user_id, org_id, role, created_at
             FROM user_org_memberships WHERE user_id = ?1",
            [user_id],
            row_to_user_org_membership,
        )
        .ok()
    }

    pub async fn add_user_to_org(&self, membership: &UserOrgMembership) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO user_org_memberships
             (id, user_id, org_id, role, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                membership.id,
                membership.user_id,
                membership.org_id,
                membership.role.as_str(),
                membership.created_at,
            ],
        )
        .map_err(|e| format!("failed to insert user-org membership: {e}"))?;
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
        country: row.get(5)?,
        role: row.get(6)?,
        vc_verified_at: row.get(7)?,
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

fn row_to_user_org_membership(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserOrgMembership> {
    let role_str: String = row.get(3)?;
    Ok(UserOrgMembership {
        id: row.get(0)?,
        user_id: row.get(1)?,
        org_id: row.get(2)?,
        role: OrgRole::from_str(&role_str),
        created_at: row.get(4)?,
    })
}
