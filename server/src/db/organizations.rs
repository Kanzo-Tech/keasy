use rusqlite::params;

use super::Database;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Organization {
    pub id: String,
    pub name: String,
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
             (id, name, legal_name, registration_number, country, role, vc_verified_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                org.id,
                org.name,
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
            "SELECT id, name, legal_name, registration_number, country, role, vc_verified_at, created_at, updated_at
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

    pub async fn list_organizations(&self) -> Vec<Organization> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, legal_name, registration_number, country, role, vc_verified_at, created_at, updated_at
                 FROM organizations ORDER BY name",
            )
            .expect("prepare list organizations");
        stmt.query_map([], row_to_org)
            .expect("query organizations")
            .filter_map(|r| r.ok())
            .collect()
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
        legal_name: row.get(2)?,
        registration_number: row.get(3)?,
        country: row.get(4)?,
        role: row.get(5)?,
        vc_verified_at: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
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
