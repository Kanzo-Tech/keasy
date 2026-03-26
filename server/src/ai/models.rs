use serde::{Deserialize, Serialize};

use crate::graph::types::TabularData;

/// Result code for AI ask responses — replaces raw string literals.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AskResultCode {
    Success,
    ParseFailed,
    QueryFailed,
    InsufficientCredits,
    LlmFailed,
}

impl AskResultCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::ParseFailed => "parse_failed",
            Self::QueryFailed => "query_failed",
            Self::InsufficientCredits => "insufficient_credits",
            Self::LlmFailed => "llm_failed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct Conversation {
    pub id: String,
    pub job_id: String,
    pub created_at: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<TabularData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    pub created_at: String,
}
