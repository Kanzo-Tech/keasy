use rusqlite::params;

use super::Database;

#[derive(Debug, Clone)]
pub struct Dataspace {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct OrgDataspaceMembership {
    pub id: String,
    pub org_id: String,
    pub dataspace_id: String,
    pub role: DataspaceRole,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DataspaceRole {
    Promotor,
    Participant,
}

impl DataspaceRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            DataspaceRole::Promotor => "promotor",
            DataspaceRole::Participant => "participant",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "participant" => DataspaceRole::Participant,
            _ => DataspaceRole::Promotor,
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

    pub fn from_str(s: &str) -> Self {
        match s {
            "user" => OrgRole::User,
            _ => OrgRole::Admin,
        }
    }
}

impl Database {
    pub async fn create_dataspace(&self, ds: &Dataspace) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO dataspaces (id, name, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![ds.id, ds.name, ds.description, ds.created_at, ds.updated_at],
        )
        .map_err(|e| format!("failed to insert dataspace: {e}"))?;
        Ok(())
    }

    pub async fn get_dataspace(&self, id: &str) -> Option<Dataspace> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, description, created_at, updated_at
             FROM dataspaces WHERE id = ?1",
            [id],
            row_to_dataspace,
        )
        .ok()
    }

    pub async fn list_dataspaces(&self) -> Vec<Dataspace> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, description, created_at, updated_at
                 FROM dataspaces ORDER BY name",
            )
            .expect("prepare list dataspaces");
        stmt.query_map([], row_to_dataspace)
            .expect("query dataspaces")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn add_org_to_dataspace(
        &self,
        membership: &OrgDataspaceMembership,
    ) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO org_dataspace_memberships
             (id, org_id, dataspace_id, role, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                membership.id,
                membership.org_id,
                membership.dataspace_id,
                membership.role.as_str(),
                membership.created_at,
            ],
        )
        .map_err(|e| format!("failed to insert org-dataspace membership: {e}"))?;
        Ok(())
    }

    pub async fn list_dataspaces_for_org(&self, org_id: &str) -> Vec<Dataspace> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT d.id, d.name, d.description, d.created_at, d.updated_at
                 FROM dataspaces d
                 JOIN org_dataspace_memberships m ON m.dataspace_id = d.id
                 WHERE m.org_id = ?1
                 ORDER BY d.name",
            )
            .expect("prepare list dataspaces for org");
        stmt.query_map([org_id], row_to_dataspace)
            .expect("query dataspaces for org")
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

fn row_to_dataspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<Dataspace> {
    Ok(Dataspace {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
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
