use serde::{Deserialize, Serialize};

use crate::discovery::rdf_graph::TabularData;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub job_id: String,
    pub created_at: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sparql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<TabularData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub created_at: String,
}
