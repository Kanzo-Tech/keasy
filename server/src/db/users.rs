use rusqlite::params;

use super::Database;

/// User with their role in a specific organization, for org admin user management.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct UserWithRole {
    pub id: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub status: String,
    pub created_at: String,
    pub role: String,
}

#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub password_hash: String,
    pub status: UserStatus,
    pub created_at: String,
    pub updated_at: String,
    pub vc_holder_did: Option<String>,
    pub wallet_connected_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum UserStatus {
    Active,
    Inactive,
}

impl UserStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserStatus::Active => "active",
            UserStatus::Inactive => "inactive",
        }
    }
}

impl Database {
    pub async fn create_user(&self, user: &User) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO users (id, email, first_name, last_name, password_hash, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                user.id,
                user.email,
                user.first_name,
                user.last_name,
                user.password_hash,
                user.status.as_str(),
                user.created_at,
                user.updated_at,
            ],
        )
        .map_err(|e| format!("failed to insert user: {e}"))?;
        Ok(())
    }

    pub async fn get_user_by_email(&self, email: &str) -> Option<User> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, email, first_name, last_name, password_hash, status, created_at, updated_at, vc_holder_did, wallet_connected_at
             FROM users WHERE email = ?1",
            [email],
            row_to_user,
        )
        .ok()
    }

    pub async fn get_user(&self, id: &str) -> Option<User> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, email, first_name, last_name, password_hash, status, created_at, updated_at, vc_holder_did, wallet_connected_at
             FROM users WHERE id = ?1",
            [id],
            row_to_user,
        )
        .ok()
    }

    pub async fn activate_user(&self, id: &str) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        conn.execute(
            "UPDATE users SET status = 'active', updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| format!("failed to activate user: {e}"))?;
        Ok(())
    }

    /// Create a user_org_membership entry to assign a user to an organization.
    /// Called during registration to attach the new user to the org from the invite token.
    pub async fn create_user_org_membership(
        &self,
        id: &str,
        user_id: &str,
        org_id: &str,
        role: &str,
    ) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO user_org_memberships (id, user_id, org_id, role, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, user_id, org_id, role, now],
        )
        .map_err(|e| format!("failed to insert user_org_membership: {e}"))?;
        Ok(())
    }

    /// Link a DID to a user account. Called when a user first links their
    /// Verifiable Credential identity from account settings.
    pub async fn link_did_to_user(&self, user_id: &str, did: &str) -> Result<(), rusqlite::Error> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        conn.execute(
            "UPDATE users SET vc_holder_did = ?1, updated_at = ?2 WHERE id = ?3",
            params![did, now, user_id],
        )?;
        Ok(())
    }

    /// Update wallet_connected_at timestamp for a user.
    pub async fn update_wallet_connected_at(&self, user_id: &str) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        conn.execute(
            "UPDATE users SET wallet_connected_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![now, now, user_id],
        )
        .map_err(|e| format!("failed to update wallet_connected_at: {e}"))?;
        Ok(())
    }

    /// Disconnect wallet — clear vc_holder_did and wallet_connected_at.
    pub async fn unlink_did_from_user(&self, user_id: &str) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        conn.execute(
            "UPDATE users SET vc_holder_did = NULL, wallet_connected_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, user_id],
        )
        .map_err(|e| format!("failed to unlink DID: {e}"))?;
        Ok(())
    }

    /// List all users in a given organization with their org role.
    pub async fn list_users_in_org(&self, org_id: &str) -> Vec<UserWithRole> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT u.id, u.email, u.first_name, u.last_name, u.status, u.created_at, m.role
                 FROM users u
                 JOIN user_org_memberships m ON m.user_id = u.id
                 WHERE m.org_id = ?1
                 ORDER BY u.email",
            )
            .expect("prepare list users in org");
        stmt.query_map([org_id], |row| {
            Ok(UserWithRole {
                id: row.get(0)?,
                email: row.get(1)?,
                first_name: row.get(2)?,
                last_name: row.get(3)?,
                status: row.get(4)?,
                created_at: row.get(5)?,
                role: row.get(6)?,
            })
        })
        .expect("query users in org")
        .filter_map(|r| r.ok())
        .collect()
    }

    /// Update a user's role within a specific organization.
    pub async fn update_user_role_in_org(
        &self,
        user_id: &str,
        org_id: &str,
        new_role: &str,
    ) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "UPDATE user_org_memberships SET role = ?1 WHERE user_id = ?2 AND org_id = ?3",
            params![new_role, user_id, org_id],
        )
        .map_err(|e| format!("failed to update user role: {e}"))?;
        Ok(())
    }

    /// Remove a user from an organization (delete their membership).
    pub async fn remove_user_from_org(&self, user_id: &str, org_id: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "DELETE FROM user_org_memberships WHERE user_id = ?1 AND org_id = ?2",
            params![user_id, org_id],
        )
        .map_err(|e| format!("failed to remove user from org: {e}"))?;
        Ok(())
    }

    /// Upsert a user by their Keycloak subject (sub) claim.
    ///
    /// `users.id` IS the Keycloak sub — no separate `subject` column.
    /// INSERT with id=sub, ON CONFLICT(id) update email/name.
    ///
    /// Returns the Keycloak sub (= user id).
    pub async fn upsert_user_by_subject(
        &self,
        subject: &str,
        email: Option<&str>,
        first_name: Option<&str>,
        last_name: Option<&str>,
    ) -> Result<String, String> {
        let email_val = email.unwrap_or(subject);
        let first = first_name.unwrap_or("");
        let last = last_name.unwrap_or("");
        let now = jiff::Timestamp::now().to_string();

        let conn = self.write().await;
        conn.execute(
            "INSERT INTO users (id, email, first_name, last_name, password_hash, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET email = ?2, first_name = ?3, last_name = ?4, updated_at = ?7",
            params![
                subject,
                email_val,
                first,
                last,
                "",       // password_hash — OIDC users have no local password
                "active",
                now,
            ],
        )
        .map_err(|e| format!("failed to upsert OIDC user: {e}"))?;

        Ok(subject.to_string())
    }
}

fn row_to_user(row: &rusqlite::Row<'_>) -> rusqlite::Result<User> {
    let status_str: String = row.get(5)?;
    Ok(User {
        id: row.get(0)?,
        email: row.get(1)?,
        first_name: row.get(2)?,
        last_name: row.get(3)?,
        password_hash: row.get(4)?,
        status: if status_str == "active" {
            UserStatus::Active
        } else {
            UserStatus::Inactive
        },
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        vc_holder_did: row.get(8)?,
        wallet_connected_at: row.get(9)?,
    })
}
