use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    User,
    Assistant,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

/// One model call. The browser writes the prompt and keeps the conversation;
/// the server holds the key and relays the answer.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CompletionRequest {
    /// The model connection to call. May be left out while the workspace has
    /// exactly one.
    #[serde(default)]
    pub connection: Option<String>,
    pub system: String,
    /// The conversation, oldest first, ending with the user's turn.
    pub messages: Vec<ChatMessage>,
    /// Fewer tokens than the connection allows.
    pub max_tokens: Option<u32>,
}
