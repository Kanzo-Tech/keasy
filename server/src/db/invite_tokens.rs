use rusqlite::params;
use super::Database;

#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct InviteToken {
    pub token: String,
    pub email: Option<String>,
    pub org_id: String,
    pub role: String,
    pub created_by: String,
    pub used_at: Option<String>,
    pub expires_at: String,
    pub created_at: String,
}

impl Database {
    /// Look up an invite token by its value.
    pub async fn get_invite_token(&self, token: &str) -> Option<InviteToken> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT token, email, org_id, role, created_by, used_at, expires_at, created_at
             FROM invite_tokens WHERE token = ?1",
            [token],
            |row| {
                Ok(InviteToken {
                    token: row.get(0)?,
                    email: row.get(1)?,
                    org_id: row.get(2)?,
                    role: row.get(3)?,
                    created_by: row.get(4)?,
                    used_at: row.get(5)?,
                    expires_at: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .ok()
    }

    /// Mark an invite token as used. Sets used_at to now.
    pub async fn mark_invite_token_used(&self, token: &str) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        conn.execute(
            "UPDATE invite_tokens SET used_at = ?1 WHERE token = ?2",
            params![now, token],
        )
        .map_err(|e| format!("failed to mark invite token used: {e}"))?;
        Ok(())
    }

    /// List all invite tokens ordered by created_at DESC.
    pub async fn list_invite_tokens(&self) -> Vec<InviteToken> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT token, email, org_id, role, created_by, used_at, expires_at, created_at
                 FROM invite_tokens ORDER BY created_at DESC",
            )
            .expect("prepare list invite tokens");
        stmt.query_map([], |row| {
            Ok(InviteToken {
                token: row.get(0)?,
                email: row.get(1)?,
                org_id: row.get(2)?,
                role: row.get(3)?,
                created_by: row.get(4)?,
                used_at: row.get(5)?,
                expires_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .expect("query invite tokens")
        .filter_map(|r| r.ok())
        .collect()
    }

    /// List invite tokens for a specific org, ordered by created_at DESC.
    pub async fn list_invite_tokens_for_org(&self, org_id: &str) -> Vec<InviteToken> {
        let org_id = org_id.to_string();
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT token, email, org_id, role, created_by, used_at, expires_at, created_at
                 FROM invite_tokens WHERE org_id = ?1 ORDER BY created_at DESC",
            )
            .expect("prepare list invite tokens for org");
        stmt.query_map([&org_id], |row| {
            Ok(InviteToken {
                token: row.get(0)?,
                email: row.get(1)?,
                org_id: row.get(2)?,
                role: row.get(3)?,
                created_by: row.get(4)?,
                used_at: row.get(5)?,
                expires_at: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .expect("query invite tokens for org")
        .filter_map(|r| r.ok())
        .collect()
    }

    /// Delete an invite token by value.
    pub async fn delete_invite_token(&self, token: &str) -> Result<(), String> {
        let conn = self.write().await;
        let affected = conn
            .execute("DELETE FROM invite_tokens WHERE token = ?1", [token])
            .map_err(|e| format!("failed to delete invite token: {e}"))?;
        if affected == 0 {
            return Err("invite token not found".to_string());
        }
        Ok(())
    }

    /// Create a new invite token.
    pub async fn create_invite_token(&self, token: &InviteToken) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO invite_tokens (token, email, org_id, role, created_by, used_at, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                token.token,
                token.email,
                token.org_id,
                token.role,
                token.created_by,
                token.used_at,
                token.expires_at,
                token.created_at,
            ],
        )
        .map_err(|e| format!("failed to insert invite token: {e}"))?;
        Ok(())
    }

    /// Store or update the active session for a user (single session enforcement).
    /// Uses INSERT OR REPLACE — if user already has a session, it's replaced atomically.
    /// Returns the previous session_id if one existed (so caller can delete from tower-sessions store).
    pub async fn upsert_user_session(&self, user_id: &str, session_id: &str) -> Result<Option<String>, String> {
        let now = jiff::Timestamp::now().to_string();
        let conn = self.write().await;
        // First get old session_id (if any) so caller can delete it from tower-sessions store
        let old_session_id: Option<String> = conn
            .query_row(
                "SELECT session_id FROM user_sessions WHERE user_id = ?1",
                [user_id],
                |row| row.get(0),
            )
            .ok();
        conn.execute(
            "INSERT OR REPLACE INTO user_sessions (user_id, session_id, created_at)
             VALUES (?1, ?2, ?3)",
            params![user_id, session_id, now],
        )
        .map_err(|e| format!("failed to upsert user session: {e}"))?;
        Ok(old_session_id)
    }

    /// Remove the user_sessions entry for a user (on logout).
    pub async fn delete_user_session(&self, user_id: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "DELETE FROM user_sessions WHERE user_id = ?1",
            [user_id],
        )
        .map_err(|e| format!("failed to delete user session: {e}"))?;
        Ok(())
    }

    /// Look up the active session_id for a user.
    /// Used by session_required middleware to enforce single active session:
    /// if the session_id in the request doesn't match, the session is stale/orphaned.
    pub async fn get_user_session_id(&self, user_id: &str) -> Option<String> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT session_id FROM user_sessions WHERE user_id = ?1",
            [user_id],
            |row| row.get(0),
        )
        .ok()
    }
}
