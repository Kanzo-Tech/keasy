use serde::{Deserialize, Serialize};

use crate::settings::ai::AiProvider;

/// A provider keasy can call, and the model it runs when none is configured.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AiProviderInfo {
    pub provider: AiProvider,
    pub default_model: &'static str,
}

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
    /// The configured provider to call; the first configured one when absent.
    pub provider: Option<AiProvider>,
    pub system: String,
    /// The conversation, oldest first, ending with the user's turn.
    pub messages: Vec<ChatMessage>,
    /// Overrides the provider's configured `max_tokens`.
    pub max_tokens: Option<u32>,
}
