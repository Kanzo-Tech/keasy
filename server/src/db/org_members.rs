use std::fmt;

use rusqlite::params;

use crate::settings::org::WorkspaceIdentity;

use super::Database;

/// Role of a user within their workspace. Two hierarchical roles: the `Owner`
/// is bootstrapped from config; everyone else joins as a `Member` via invite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberRole {
    Owner,
    Member,
}

impl MemberRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            MemberRole::Owner => "owner",
            MemberRole::Member => "member",
        }
    }
}

impl std::str::FromStr for MemberRole {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "owner" => Ok(MemberRole::Owner),
            "member" => Ok(MemberRole::Member),
            other => Err(format!("invalid role: '{other}', expected 'owner' or 'member'")),
        }
    }
}

impl fmt::Display for MemberRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A workspace member — a Keycloak user's membership in this instance.
/// Profile fields (email, first_name, last_name) are cached from OIDC tokens.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct OrgMember {
    pub user_id: String,
    pub role: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub joined_at: String,
}

impl Database {
    /// Upsert a membership when a user accepts an invite (or on owner bootstrap).
    /// Creates or updates the row for `user_id`, setting role and profile fields.
    pub async fn upsert_org_member(
        &self,
        user_id: &str,
        role: &str,
        email: &str,
        first_name: &str,
        last_name: &str,
    ) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO org_members (user_id, role, email, first_name, last_name, joined_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(user_id) DO UPDATE SET
               role = excluded.role,
               email = excluded.email,
               first_name = excluded.first_name,
               last_name = excluded.last_name",
            params![user_id, role, email, first_name, last_name, now],
        )
        .map_err(|e| format!("failed to upsert org member: {e}"))?;
        Ok(())
    }

    /// Idempotently ensure the owner membership + workspace identity exist
    /// (W7 control-plane bootstrap). The owner is the SINGLE bootstrap datum the
    /// instance derives from config (`owner_keycloak_sub`) — it replaces the old
    /// SQL seeds, fixed UUIDs, and the open invite token. Re-running is a no-op.
    pub async fn ensure_owner_bootstrap(
        &self,
        owner_keycloak_sub: &str,
        workspace_name: &str,
    ) -> Result<(), String> {
        if self.get_workspace_identity().await.is_none() {
            self.set_workspace_identity(&WorkspaceIdentity {
                name: workspace_name.to_string(),
                legal_name: workspace_name.to_string(),
                country: "EU".to_string(),
                ..Default::default()
            })
            .await;
        }
        self.upsert_org_member(owner_keycloak_sub, "owner", "", "", "")
            .await
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

    /// Get the membership for a user.
    pub async fn get_org_membership(&self, user_id: &str) -> Option<OrgMember> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT user_id, role, email, first_name, last_name, joined_at
             FROM org_members WHERE user_id = ?1",
            [user_id],
            row_to_member,
        )
        .ok()
    }

    /// List all members of the workspace.
    pub async fn list_org_members(&self) -> Vec<OrgMember> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT user_id, role, email, first_name, last_name, joined_at
                 FROM org_members ORDER BY email",
            )
            .expect("prepare list org members");
        stmt.query_map([], row_to_member)
            .expect("query org members")
            .filter_map(|r| r.ok())
            .collect()
    }

    /// Remove a user from the workspace.
    pub async fn remove_org_member(&self, user_id: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute("DELETE FROM org_members WHERE user_id = ?1", [user_id])
            .map_err(|e| format!("failed to remove org member: {e}"))?;
        Ok(())
    }
}

fn row_to_member(row: &rusqlite::Row<'_>) -> rusqlite::Result<OrgMember> {
    Ok(OrgMember {
        user_id: row.get(0)?,
        role: row.get(1)?,
        email: row.get(2)?,
        first_name: row.get(3)?,
        last_name: row.get(4)?,
        joined_at: row.get(5)?,
    })
}
