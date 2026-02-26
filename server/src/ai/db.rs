use rusqlite::params;

use crate::db::Database;
use crate::jobs::models::now_iso8601;
use crate::graph::rdf_graph::TabularData;
use crate::tenant::TenantContext;

use super::models::{Conversation, ConversationMessage};

impl Database {
    pub async fn create_conversation(&self, ctx: &TenantContext, job_id: &str, title: Option<String>) -> Conversation {
        let conv = Conversation {
            id: uuid::Uuid::new_v4().to_string(),
            job_id: job_id.to_string(),
            created_at: now_iso8601(),
            title,
        };
        let conn = self.write().await;
        let _ = conn.execute(
            "INSERT INTO conversations (id, organization_id, job_id, created_at, title) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![conv.id, ctx.org_id().as_str(), conv.job_id, conv.created_at, conv.title],
        );
        conv
    }

    pub async fn list_conversations(&self, ctx: &TenantContext, job_id: &str) -> Vec<Conversation> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, job_id, created_at, title FROM conversations WHERE job_id = ?1 AND organization_id = ?2 ORDER BY created_at DESC",
            )
            .expect("prepare list conversations");
        stmt.query_map(params![job_id, ctx.org_id().as_str()], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                job_id: row.get(1)?,
                created_at: row.get(2)?,
                title: row.get(3)?,
            })
        })
        .expect("query conversations")
        .filter_map(|r| r.ok())
        .collect()
    }

    pub async fn add_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
        sparql: Option<&str>,
        data: Option<&TabularData>,
        code: Option<&str>,
    ) -> ConversationMessage {
        let msg = ConversationMessage {
            id: uuid::Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            sparql: sparql.map(|s| s.to_string()),
            data: data.cloned(),
            code: code.map(|s| s.to_string()),
            created_at: now_iso8601(),
        };
        let data_json = msg.data.as_ref().map(|d| serde_json::to_string(d).unwrap());
        let conn = self.write().await;
        let _ = conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, sparql, data, code, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                msg.id,
                msg.conversation_id,
                msg.role,
                msg.content,
                msg.sparql,
                data_json,
                msg.code,
                msg.created_at,
            ],
        );
        msg
    }

    pub async fn get_messages(&self, conversation_id: &str) -> Vec<ConversationMessage> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, conversation_id, role, content, sparql, data, code, created_at
                 FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
            )
            .expect("prepare get messages");
        stmt.query_map([conversation_id], |row| {
            let data_json: Option<String> = row.get(5)?;
            Ok(ConversationMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                sparql: row.get(4)?,
                data: data_json.and_then(|j| serde_json::from_str(&j).ok()),
                code: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .expect("query messages")
        .filter_map(|r| r.ok())
        .collect()
    }

    pub async fn rename_conversation(&self, id: &str, title: &str) {
        let conn = self.write().await;
        let _ = conn.execute(
            "UPDATE conversations SET title = ?1 WHERE id = ?2",
            params![title, id],
        );
    }

    pub async fn delete_conversation(&self, id: &str) {
        let conn = self.write().await;
        let _ = conn.execute("DELETE FROM conversations WHERE id = ?1", [id]);
    }
}
