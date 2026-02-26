use rusqlite::params;

use super::Database;

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
            "SELECT id, email, first_name, last_name, password_hash, status, created_at, updated_at
             FROM users WHERE email = ?1",
            [email],
            row_to_user,
        )
        .ok()
    }

    pub async fn get_user(&self, id: &str) -> Option<User> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, email, first_name, last_name, password_hash, status, created_at, updated_at
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
    })
}
