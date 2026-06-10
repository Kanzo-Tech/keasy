use std::convert::Infallible;
use std::fmt;

use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use futures::StreamExt;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::warn;

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

#[derive(Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
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

static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(reqwest::Client::new);

/// Validate that an AI provider is configured with a non-empty API key.
pub fn require_ai_settings(
    settings: Option<AiSettings>,
) -> Result<AiSettings, (axum::http::StatusCode, axum::Json<serde_json::Value>)> {
    use axum::http::StatusCode;
    use axum::Json;
    match settings {
        Some(s) if !s.api_key.expose_secret().is_empty() => Ok(s),
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(crate::error::error_body(
                "ai_not_configured",
                "AI settings are not configured. Go to Settings > AI to add an API key.",
            )),
        )),
    }
}

async fn classify_api_error(res: reqwest::Response, provider: &str) -> AiError {
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    let message = body["error"]["message"]
        .as_str()
        .unwrap_or("Unknown API error");
    let code = body["error"]["code"].as_str().unwrap_or("");
    let formatted = format!("{message} ({provider}, {status})");

    let is_credits = status.as_u16() == 402
        || code == "insufficient_quota"
        || (status.as_u16() == 429 && message.to_lowercase().contains("credit"));

    if is_credits {
        AiError::InsufficientCredits(formatted)
    } else {
        AiError::Failed(formatted)
    }
}

pub async fn ask_llm(settings: &AiSettings, system: &str, user: &str) -> Result<String, AiError> {
    let messages = [Message {
        role: "user".to_string(),
        content: user.to_string(),
    }];
    ask_llm_multi(settings, system, &messages, None).await
}

pub async fn ask_llm_multi(
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens_override: Option<u32>,
) -> Result<String, AiError> {
    let client = &*HTTP_CLIENT;
    let max_tokens = max_tokens_override.unwrap_or(settings.max_tokens.unwrap_or(2048));

    match settings.provider.as_str() {
        "openai" => ask_openai(client, settings, system, messages, max_tokens).await,
        _ => ask_anthropic(client, settings, system, messages, max_tokens).await,
    }
}

async fn ask_anthropic(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens: u32,
) -> Result<String, AiError> {
    let model = settings
        .model
        .as_deref()
        .unwrap_or("claude-sonnet-4-20250514");

    let body = AnthropicRequest {
        model: model.to_string(),
        max_tokens,
        system: system.to_string(),
        messages: messages.to_vec(),
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
        return Err(classify_api_error(res, "anthropic").await);
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
    messages: &[Message],
    max_tokens: u32,
) -> Result<String, AiError> {
    let model = settings.model.as_deref().unwrap_or("gpt-4o");

    let mut all_messages = vec![Message {
        role: "system".to_string(),
        content: system.to_string(),
    }];
    all_messages.extend_from_slice(messages);

    let body = OpenAiRequest {
        model: model.to_string(),
        max_tokens,
        messages: all_messages,
    };

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .header(
            "Authorization",
            format!("Bearer {}", settings.api_key.expose_secret()),
        )
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("OpenAI request failed: {e}")))?;

    if !res.status().is_success() {
        return Err(classify_api_error(res, "openai").await);
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

// ── Streaming ────────────────────────────────────────────────────────────

pub async fn ask_llm_stream(
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens_override: Option<u32>,
    tx: mpsc::Sender<String>,
) -> Result<String, AiError> {
    let client = &*HTTP_CLIENT;
    let max_tokens = max_tokens_override.unwrap_or(settings.max_tokens.unwrap_or(2048));

    match settings.provider.as_str() {
        "openai" => stream_openai(client, settings, system, messages, max_tokens, tx).await,
        _ => stream_anthropic(client, settings, system, messages, max_tokens, tx).await,
    }
}

async fn stream_anthropic(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens: u32,
    tx: mpsc::Sender<String>,
) -> Result<String, AiError> {
    let model = settings.model.as_deref().unwrap_or("claude-sonnet-4-20250514");

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
        "stream": true,
    });

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", settings.api_key.expose_secret())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("Anthropic stream request failed: {e}")))?;

    if !res.status().is_success() {
        return Err(classify_api_error(res, "anthropic").await);
    }

    consume_sse_stream(res, &tx, |v| v["delta"]["text"].as_str()).await
}

async fn stream_openai(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens: u32,
    tx: mpsc::Sender<String>,
) -> Result<String, AiError> {
    let model = settings.model.as_deref().unwrap_or("gpt-4o");

    let mut all_messages = vec![Message {
        role: "system".to_string(),
        content: system.to_string(),
    }];
    all_messages.extend_from_slice(messages);

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": all_messages,
        "stream": true,
    });

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", settings.api_key.expose_secret()))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("OpenAI stream request failed: {e}")))?;

    if !res.status().is_success() {
        return Err(classify_api_error(res, "openai").await);
    }

    consume_sse_stream(res, &tx, |v| v["choices"][0]["delta"]["content"].as_str()).await
}

async fn consume_sse_stream(
    res: reqwest::Response,
    tx: &mpsc::Sender<String>,
    extract_text: impl Fn(&serde_json::Value) -> Option<&str>,
) -> Result<String, AiError> {
    let mut accumulated = String::new();
    let mut stream = res.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AiError::Failed(format!("Stream read error: {e}")))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buf.find("\n\n") {
            let event_block = &buf[..pos];
            for line in event_block.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" { continue; }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(text) = extract_text(&v) {
                            accumulated.push_str(text);
                            let _ = tx.send(text.to_string()).await;
                        }
                    }
                }
            }
            buf.drain(..pos + 2);
        }
    }

    Ok(accumulated)
}

pub struct SseChannels {
    pub sse_tx: mpsc::Sender<Result<Event, Infallible>>,
    pub sse_rx: mpsc::Receiver<Result<Event, Infallible>>,
    pub delta_tx: mpsc::Sender<String>,
}

pub fn setup_sse_channels() -> SseChannels {
    let (sse_tx, sse_rx) = mpsc::channel::<Result<Event, Infallible>>(32);
    let (delta_tx, mut delta_rx) = mpsc::channel::<String>(32);

    let tx_fwd = sse_tx.clone();
    tokio::spawn(async move {
        while let Some(delta) = delta_rx.recv().await {
            let _ = tx_fwd
                .send(Ok(Event::default().event("delta").data(delta)))
                .await;
        }
    });

    SseChannels { sse_tx, sse_rx, delta_tx }
}

pub fn into_sse_response(sse_rx: mpsc::Receiver<Result<Event, Infallible>>) -> Response {
    Sse::new(ReceiverStream::new(sse_rx))
        .keep_alive(KeepAlive::default())
        .into_response()
}

pub fn stream_llm_to_sse(
    ai_settings: AiSettings,
    system_prompt: String,
    user_message: String,
    max_tokens: Option<u32>,
    parse_result: impl FnOnce(&str) -> serde_json::Value + Send + 'static,
) -> Response {
    let ch = setup_sse_channels();

    let sse_tx = ch.sse_tx;
    let delta_tx = ch.delta_tx;
    tokio::spawn(async move {
        let msgs = [Message {
            role: "user".into(),
            content: user_message,
        }];

        match ask_llm_stream(&ai_settings, &system_prompt, &msgs, max_tokens, delta_tx).await {
            Ok(full_text) => {
                let payload = parse_result(&full_text);
                let _ = sse_tx
                    .send(Ok(Event::default().event("complete").data(payload.to_string())))
                    .await;
            }
            Err(e) => {
                let code = match &e {
                    AiError::InsufficientCredits(_) => "insufficient_credits",
                    AiError::Failed(_) => "llm_failed",
                };
                warn!("LLM stream failed: {e}");
                let err = serde_json::json!({"code": code, "message": e.to_string()});
                let _ = sse_tx
                    .send(Ok(Event::default().event("error").data(err.to_string())))
                    .await;
            }
        }
    });

    into_sse_response(ch.sse_rx)
}
