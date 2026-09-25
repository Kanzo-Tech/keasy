use secrecy::SecretString;
use serde::{Deserialize, Serialize};

/// An LLM provider keasy can call.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::VariantArray,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum AiProvider {
    Anthropic,
    Openai,
}

impl AiProvider {
    /// The model an ask runs on when the provider's settings name none.
    pub fn default_model(self) -> &'static str {
        match self {
            AiProvider::Anthropic => "claude-sonnet-4-20250514",
            AiProvider::Openai => "gpt-4o",
        }
    }
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
