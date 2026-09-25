use keasy_api::settings::ai::AiProvider;
use secrecy::SecretString;

pub struct AiSettings {
    pub provider: AiProvider,
    pub api_key: SecretString,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
}
