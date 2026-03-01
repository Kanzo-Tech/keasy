use secrecy::SecretString;
use serde::{Deserialize, Serialize};

pub struct AiSettings {
    pub provider: String,
    pub api_key: SecretString,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct AiSettingsPayload {
    pub provider: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}
