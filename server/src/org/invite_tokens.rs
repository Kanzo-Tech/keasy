use diesel::prelude::*;

use crate::db::diesel_schema::{invite_tokens, user_sessions};
use crate::db::Repos;

#[derive(Debug, Clone, serde::Serialize, Queryable, Selectable, Insertable, utoipa::ToSchema)]
#[diesel(table_name = invite_tokens)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct InviteToken {
    pub token: String,
    pub org_id: String,
    pub role: String,
    pub created_by: String,
    pub expires_at: String,
    pub created_at: String,
}

use invite_tokens::dsl as it_dsl;
use user_sessions::dsl as us_dsl;

impl Repos {
    /// Look up an invite token by its value.
    pub async fn get_invite_token(&self, token: &str) -> Option<InviteToken> {
        let token = token.to_string();
        self.diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                it_dsl::invite_tokens
                    .filter(it_dsl::token.eq(&token))
                    .select(InviteToken::as_select())
                    .first::<InviteToken>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    /// List all invite tokens ordered by created_at DESC.
    pub async fn list_invite_tokens(&self) -> Vec<InviteToken> {
        let Ok(pc) = self.diesel_pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(|conn| {
                it_dsl::invite_tokens
                    .order(it_dsl::created_at.desc())
                    .select(InviteToken::as_select())
                    .load::<InviteToken>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    /// List invite tokens for a specific org, ordered by created_at DESC.
    pub async fn list_invite_tokens_for_org(&self, org_id: &str) -> Vec<InviteToken> {
        let org_id = org_id.to_string();
        let Ok(pc) = self.diesel_pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(move |conn| {
                it_dsl::invite_tokens
                    .filter(it_dsl::org_id.eq(&org_id))
                    .order(it_dsl::created_at.desc())
                    .select(InviteToken::as_select())
                    .load::<InviteToken>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    /// Delete an invite token by value.
    pub async fn delete_invite_token(&self, token: &str) -> Result<(), String> {
        let token = token.to_string();
        let affected = self
            .diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::delete(it_dsl::invite_tokens.filter(it_dsl::token.eq(&token))).execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to delete invite token: {e}"))?;
        if affected == 0 {
            return Err("invite token not found".to_string());
        }
        Ok(())
    }

    /// Create a new invite token.
    pub async fn create_invite_token(&self, token: &InviteToken) -> Result<(), String> {
        let token = token.clone();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(it_dsl::invite_tokens)
                    .values(&token)
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to insert invite token: {e}"))?;
        Ok(())
    }

    /// Store or update the active session for a user (single session enforcement).
    /// Uses INSERT OR REPLACE — if user already has a session, it's replaced atomically.
    /// Returns the previous session_id if one existed (so caller can delete from tower-sessions store).
    pub async fn upsert_user_session(
        &self,
        user_id: &str,
        session_id: &str,
    ) -> Result<Option<String>, String> {
        let now = jiff::Timestamp::now().to_string();
        let user_id = user_id.to_string();
        let session_id = session_id.to_string();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                // First get old session_id (if any) so caller can delete it from tower-sessions store
                let old_session_id: Option<String> = us_dsl::user_sessions
                    .filter(us_dsl::user_id.eq(&user_id))
                    .select(us_dsl::session_id)
                    .first::<String>(conn)
                    .optional()
                    .map_err(|e| format!("query old session: {e}"))?;

                // INSERT OR REPLACE
                diesel::replace_into(us_dsl::user_sessions)
                    .values((
                        us_dsl::user_id.eq(&user_id),
                        us_dsl::session_id.eq(&session_id),
                        us_dsl::created_at.eq(&now),
                    ))
                    .execute(conn)
                    .map_err(|e| format!("failed to upsert user session: {e}"))?;

                Ok(old_session_id)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
    }

    /// Remove the user_sessions entry for a user (on logout).
    pub async fn delete_user_session(&self, user_id: &str) -> Result<(), String> {
        let user_id = user_id.to_string();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::delete(us_dsl::user_sessions.filter(us_dsl::user_id.eq(&user_id)))
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to delete user session: {e}"))?;
        Ok(())
    }

    /// Look up the active session_id for a user.
    /// Used by session_required middleware to enforce single active session:
    /// if the session_id in the request doesn't match, the session is stale/orphaned.
    pub async fn get_user_session_id(&self, user_id: &str) -> Option<String> {
        let user_id = user_id.to_string();
        self.diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                us_dsl::user_sessions
                    .filter(us_dsl::user_id.eq(&user_id))
                    .select(us_dsl::session_id)
                    .first::<String>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }
}
