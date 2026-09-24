use secrecy::SecretString;
use serde::{Deserialize, Serialize};

/// An LLM provider keasy can call.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Anthropic,
    Openai,
}

impl AiProvider {
    pub const ALL: [AiProvider; 2] = [AiProvider::Anthropic, AiProvider::Openai];

    pub fn as_str(self) -> &'static str {
        match self {
            AiProvider::Anthropic => "anthropic",
            AiProvider::Openai => "openai",
        }
    }
}

pub struct AiSettings {
    pub provider: AiProvider,
    pub api_key: SecretString,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
}

/// A configured provider as the settings page shows it: the key is only ever
/// said to be there.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AiSettingsPayload {
    pub provider: AiProvider,
    /// `"••••"` when a key is stored, empty otherwise.
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SaveAiProviderRequest {
    /// Empty keeps the stored key.
    #[serde(default)]
    #[schema(value_type = String)]
    pub api_key: SecretString,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
}
