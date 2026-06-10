use rusqlite::params;

use crate::db::Database;
use crate::jobs::models::now_iso8601;
use crate::graph::types::TabularData;

use super::models::{Conversation, ConversationMessage};

impl Database {
    pub async fn create_conversation(
        &self,
        job_id: &str,
        title: Option<String>,
    ) -> Result<Conversation, String> {
        let conv = Conversation {
            id: uuid::Uuid::new_v4().to_string(),
            job_id: job_id.to_string(),
            created_at: now_iso8601(),
            title,
        };
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO conversations (id, job_id, created_at, title) VALUES (?1, ?2, ?3, ?4)",
            params![conv.id, conv.job_id, conv.created_at, conv.title],
        )
        .map_err(|e| format!("Failed to insert conversation: {e}"))?;
        Ok(conv)
    }

    pub async fn list_conversations(&self, job_id: &str) -> Vec<Conversation> {
        let (_permit, conn) = self.read().await;
        let mut stmt = match conn.prepare(
            "SELECT id, job_id, created_at, title FROM conversations WHERE job_id = ?1 ORDER BY created_at DESC",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "Failed to prepare list conversations");
                return vec![];
            }
        };
        match stmt.query_map([job_id], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                job_id: row.get(1)?,
                created_at: row.get(2)?,
                title: row.get(3)?,
            })
        }) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                tracing::error!(error = %e, "Failed to query conversations");
                vec![]
            }
        }
    }

    pub async fn get_conversation(&self, id: &str) -> Option<Conversation> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, job_id, created_at, title FROM conversations WHERE id = ?1",
            [id],
            |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    job_id: row.get(1)?,
                    created_at: row.get(2)?,
                    title: row.get(3)?,
                })
            },
        )
        .ok()
    }

    pub async fn add_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
        sql: Option<&str>,
        data: Option<&TabularData>,
        code: Option<&str>,
    ) -> Result<ConversationMessage, String> {
        let msg = ConversationMessage {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            sql: sql.map(|s| s.to_string()),
            data: data.cloned(),
            code: code.map(|s| s.to_string()),
            explanation: None,
            created_at: now_iso8601(),
        };
        let data_json = msg.data.as_ref().map(|d| serde_json::to_string(d).unwrap());
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, sql, data, code, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                msg.id,
                msg.conversation_id,
                msg.role,
                msg.content,
                msg.sql,
                data_json,
                msg.code,
                msg.created_at,
            ],
        )
        .map_err(|e| format!("Failed to insert message: {e}"))?;
        Ok(msg)
    }

    pub async fn update_message_explanation(&self, message_id: &str, explanation: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "UPDATE messages SET explanation = ?1 WHERE id = ?2",
            params![explanation, message_id],
        )
        .map_err(|e| format!("Failed to update explanation: {e}"))?;
        Ok(())
    }

    pub async fn get_messages(&self, conversation_id: &str) -> Vec<ConversationMessage> {
        let (_permit, conn) = self.read().await;
        let mut stmt = match conn.prepare(
            "SELECT id, conversation_id, role, content, sql, data, code, explanation, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "Failed to prepare get messages");
                return vec![];
            }
        };
        match stmt.query_map([conversation_id], |row| {
            let data_json: Option<String> = row.get(5)?;
            Ok(ConversationMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                sql: row.get(4)?,
                data: data_json.and_then(|j| serde_json::from_str(&j).ok()),
                code: row.get(6)?,
                explanation: row.get(7)?,
                created_at: row.get(8)?,
            })
        }) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                tracing::error!(error = %e, "Failed to query messages");
                vec![]
            }
        }
    }

    pub async fn rename_conversation(&self, id: &str, title: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "UPDATE conversations SET title = ?1 WHERE id = ?2",
            params![title, id],
        )
        .map_err(|e| format!("Failed to rename conversation: {e}"))?;
        Ok(())
    }

    pub async fn delete_conversation(&self, id: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "DELETE FROM conversations WHERE id = ?1",
            [id],
        )
        .map_err(|e| format!("Failed to delete conversation: {e}"))?;
        Ok(())
    }
}
