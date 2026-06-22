use rusqlite::params;
use super::Database;

impl Database {
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
