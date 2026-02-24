use std::fmt;

use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use crate::settings::ai::AiSettings;

pub enum AiError {
    InsufficientCredits(String),
    Failed(String),
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AiError::InsufficientCredits(msg) | AiError::Failed(msg) => f.write_str(msg),
        }
    }
}

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<Message>,
}

#[derive(Serialize)]
struct OpenAiRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
}

pub async fn ask_llm(settings: &AiSettings, system: &str, user: &str) -> Result<String, AiError> {
    let client = reqwest::Client::new();

    match settings.provider.as_str() {
        "openai" => ask_openai(&client, settings, system, user).await,
        _ => ask_anthropic(&client, settings, system, user).await,
    }
}

async fn ask_anthropic(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    user: &str,
) -> Result<String, AiError> {
    let model = settings
        .model
        .as_deref()
        .unwrap_or("claude-sonnet-4-20250514");

    let body = AnthropicRequest {
        model: model.to_string(),
        max_tokens: settings.max_tokens.unwrap_or(1024),
        system: system.to_string(),
        messages: vec![Message {
            role: "user".to_string(),
            content: user.to_string(),
        }],
    };

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", settings.api_key.expose_secret())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("Anthropic request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let message = body["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        let formatted = format!("{message} (anthropic, {status})");

        if status.as_u16() == 402
            || (status.as_u16() == 429
                && message.to_lowercase().contains("credit"))
        {
            return Err(AiError::InsufficientCredits(formatted));
        }
        return Err(AiError::Failed(formatted));
    }

    let resp: AnthropicResponse = res
        .json()
        .await
        .map_err(|e| AiError::Failed(format!("Failed to parse Anthropic response: {e}")))?;

    resp.content
        .into_iter()
        .find_map(|b| b.text)
        .ok_or_else(|| AiError::Failed("Empty response from Anthropic".to_string()))
}

async fn ask_openai(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    user: &str,
) -> Result<String, AiError> {
    let model = settings
        .model
        .as_deref()
        .unwrap_or("gpt-4o");

    let body = OpenAiRequest {
        model: model.to_string(),
        max_tokens: settings.max_tokens.unwrap_or(1024),
        messages: vec![
            Message {
                role: "system".to_string(),
                content: system.to_string(),
            },
            Message {
                role: "user".to_string(),
                content: user.to_string(),
            },
        ],
    };

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", settings.api_key.expose_secret()))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("OpenAI request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let message = body["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        let code = body["error"]["code"].as_str().unwrap_or("");
        let formatted = format!("{message} (openai, {status})");

        if status.as_u16() == 402 || code == "insufficient_quota" {
            return Err(AiError::InsufficientCredits(formatted));
        }
        return Err(AiError::Failed(formatted));
    }

    let resp: OpenAiResponse = res
        .json()
        .await
        .map_err(|e| AiError::Failed(format!("Failed to parse OpenAI response: {e}")))?;

    resp.choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .ok_or_else(|| AiError::Failed("Empty response from OpenAI".to_string()))
}
