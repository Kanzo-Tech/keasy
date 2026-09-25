use serde::{Deserialize, Serialize};

use crate::settings::ai::AiProvider;

/// A provider keasy can call, and the model it runs when none is configured.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AiProviderInfo {
    pub provider: AiProvider,
    pub default_model: &'static str,
}

#[derive(Debug, Clone, Copy, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    User,
    Assistant,
}

/// One earlier message of the conversation. The client keeps the conversation;
/// the server sees only what each ask carries.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AskRequest {
    pub question: String,
    pub provider: Option<AiProvider>,
    /// DuckDB DDL of the views the browser mounted: the whole of what the model
    /// knows about the data. Required unless `explain`.
    pub schema: Option<String>,
    /// When true, the model reads query results back instead of writing SQL;
    /// `question` then carries the question, the SQL and the rows.
    #[serde(default)]
    pub explain: bool,
    /// The conversation so far, oldest first.
    #[serde(default)]
    pub history: Vec<ChatMessage>,
}
