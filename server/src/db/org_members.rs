use std::fmt;

use rusqlite::params;

use super::Database;

/// Role of a user within their organization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberRole {
    Admin,
    Member,
}

impl MemberRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemberRole::Admin => "admin",
            MemberRole::Member => "member",
        }
    }
}

impl std::str::FromStr for MemberRole {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "admin" => Ok(MemberRole::Admin),
            "member" => Ok(MemberRole::Member),
            other => Err(format!("invalid role: '{other}', expected 'admin' or 'member'")),
        }
    }
}

impl fmt::Display for MemberRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An org member — a Keycloak user's membership in a Keasy organization.
/// Profile fields (email, first_name, last_name) are cached from OIDC tokens.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct OrgMember {
    pub user_id: String,
    pub org_id: String,
    pub role: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub joined_at: String,
}

impl Database {
    /// Upsert an org membership when a user accepts an invite.
    /// Creates or updates the row for (user_id, org_id), setting role and profile fields.
    pub async fn upsert_org_member(
        &self,
        user_id: &str,
        org_id: &str,
        role: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO org_members (user_id, org_id, role, email, first_name, last_name, joined_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(user_id, org_id) DO UPDATE SET
               role = excluded.role,
               email = excluded.email,
               first_name = excluded.first_name,
               last_name = excluded.last_name",
            params![user_id, org_id, role, email, first_name, last_name, now],
        )
        .map_err(|e| format!("failed to upsert org member: {e}"))?;
        Ok(())
    }

    /// Update cached profile fields for all orgs a user belongs to.
    /// Called on every OIDC login so profile changes from Keycloak propagate.
    pub async fn sync_member_profile(
        &self,
        user_id: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "UPDATE org_members SET email = ?1, first_name = ?2, last_name = ?3 WHERE user_id = ?4",
            params![email, first_name, last_name, user_id],
        )
        .map_err(|e| format!("failed to sync member profile: {e}"))?;
        Ok(())
    }

    /// Get the org membership for a user (single-org model — returns first match).
    pub async fn get_org_membership(&self, user_id: &str) -> Option<OrgMember> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT user_id, org_id, role, email, first_name, last_name, joined_at
             FROM org_members WHERE user_id = ?1
             LIMIT 1",
            [user_id],
            |row| {
                Ok(OrgMember {
                    user_id: row.get(0)?,
                    org_id: row.get(1)?,
                    role: row.get(2)?,
                    email: row.get(3)?,
                    first_name: row.get(4)?,
                    last_name: row.get(5)?,
                    joined_at: row.get(6)?,
                })
            },
        )
        .ok()
    }

    /// List all members in an organization.
    pub async fn list_org_members(&self, org_id: &str) -> Vec<OrgMember> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT user_id, org_id, role, email, first_name, last_name, joined_at
                 FROM org_members WHERE org_id = ?1
                 ORDER BY email",
            )
            .expect("prepare list org members");
        stmt.query_map([org_id], |row| {
            Ok(OrgMember {
                user_id: row.get(0)?,
                org_id: row.get(1)?,
                role: row.get(2)?,
                email: row.get(3)?,
                first_name: row.get(4)?,
                last_name: row.get(5)?,
                joined_at: row.get(6)?,
            })
        })
        .expect("query org members")
        .filter_map(|r| r.ok())
        .collect()
    }

    /// Update a member's role within their organization.
    pub async fn update_member_role(
        &self,
        user_id: &str,
        org_id: &str,
        new_role: &str,
    ) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "UPDATE org_members SET role = ?1 WHERE user_id = ?2 AND org_id = ?3",
            params![new_role, user_id, org_id],
        )
        .map_err(|e| format!("failed to update member role: {e}"))?;
        Ok(())
    }

    /// Remove a user from an organization.
    pub async fn remove_org_member(&self, user_id: &str, org_id: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "DELETE FROM org_members WHERE user_id = ?1 AND org_id = ?2",
            params![user_id, org_id],
        )
        .map_err(|e| format!("failed to remove org member: {e}"))?;
        Ok(())
    }
}
