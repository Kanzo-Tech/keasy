use std::convert::Infallible;
use std::fmt;
use std::time::Duration;

use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use backoff::ExponentialBackoffBuilder;
use futures::StreamExt;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{debug, warn};

use crate::settings::ai::AiSettings;

// ── JSON extraction ──────────────────────────────────────────────────────

/// Extract the first valid JSON object from LLM output.
/// Handles markdown fences, preamble text, and raw JSON.
pub fn extract_json(raw: &str) -> &str {
    if let Some(start) = raw.find("```json") {
        let after = &raw[start + 7..];
        if let Some(end) = after.find("```") {
            return after[..end].trim();
        }
    }
    if let Some(start) = raw.find("```") {
        let after = &raw[start + 3..];
        if let Some(end) = after.find("```") {
            return after[..end].trim();
        }
    }
    if let Some(start) = raw.find('{') {
        if let Some(end) = raw.rfind('}') {
            return &raw[start..=end];
        }
    }
    raw.trim()
}

// ── Constants ────────────────────────────────────────────────────────────

const ANTHROPIC_API_VERSION: &str = "2024-10-22";
const ANTHROPIC_DEFAULT_MODEL: &str = "claude-sonnet-4-20250514";
const OPENAI_DEFAULT_MODEL: &str = "gpt-4o";
const MAX_RESPONSE_SIZE: usize = 10 * 1024 * 1024; // 10 MB
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

// ── Error types ──────────────────────────────────────────────────────────

pub enum AiError {
    InsufficientCredits(String),
    RateLimit(String),
    Failed(String),
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AiError::InsufficientCredits(msg)
            | AiError::RateLimit(msg)
            | AiError::Failed(msg) => f.write_str(msg),
        }
    }
}

impl AiError {
    pub fn code(&self) -> &str {
        match self {
            AiError::InsufficientCredits(_) => "insufficient_credits",
            AiError::RateLimit(_) => "rate_limit",
            AiError::Failed(_) => "llm_failed",
        }
    }

    /// Whether this error is transient and should be retried.
    fn is_transient(&self) -> bool {
        matches!(self, AiError::RateLimit(_))
    }
}

// ── Message types ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

/// Tool definition for structured output.
#[derive(Serialize, Clone)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

// ── HTTP client (configured with timeouts + pooling) ─────────────────────

static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .pool_max_idle_per_host(10)
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .tcp_keepalive(Some(Duration::from_secs(60)))
        .build()
        .expect("failed to build HTTP client")
});

// ── Validation ───────────────────────────────────────────────────────────

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

// ── Error classification ─────────────────────────────────────────────────

fn classify_api_error(status: u16, body: &str, provider: &str) -> AiError {
    let parsed: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let message = parsed["error"]["message"]
        .as_str()
        .unwrap_or(body);
    let code = parsed["error"]["code"].as_str().unwrap_or("");
    let formatted = format!("{message} ({provider}, {status})");

    match status {
        402 => AiError::InsufficientCredits(formatted),
        429 => {
            if code == "insufficient_quota" || message.to_lowercase().contains("credit") {
                AiError::InsufficientCredits(formatted)
            } else {
                AiError::RateLimit(formatted)
            }
        }
        _ => AiError::Failed(formatted),
    }
}

async fn check_response(res: reqwest::Response, provider: &str) -> Result<reqwest::Response, AiError> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    Err(classify_api_error(status, &body, provider))
}

// ── Non-streaming API ────────────────────────────────────────────────────

pub async fn ask_llm(settings: &AiSettings, system: &str, user: &str) -> Result<String, AiError> {
    let messages = [Message { role: "user".into(), content: user.into() }];
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

// ── Anthropic (non-streaming) ────────────────────────────────────────────

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum AnthropicContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse { input: serde_json::Value },
}

async fn ask_anthropic(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens: u32,
) -> Result<String, AiError> {
    let model = settings.model.as_deref().unwrap_or(ANTHROPIC_DEFAULT_MODEL);

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    });

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", settings.api_key.expose_secret())
        .header("anthropic-version", ANTHROPIC_API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("Anthropic request failed: {e}")))?;

    let res = check_response(res, "anthropic").await?;
    let resp: AnthropicResponse = res
        .json()
        .await
        .map_err(|e| AiError::Failed(format!("Failed to parse Anthropic response: {e}")))?;

    // Extract text from first text block
    resp.content
        .into_iter()
        .find_map(|b| match b {
            AnthropicContentBlock::Text { text } => Some(text),
            _ => None,
        })
        .ok_or_else(|| AiError::Failed("Empty response from Anthropic".into()))
}

// ── OpenAI (non-streaming) ───────────────────────────────────────────────

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

async fn ask_openai(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens: u32,
) -> Result<String, AiError> {
    let model = settings.model.as_deref().unwrap_or(OPENAI_DEFAULT_MODEL);

    let mut all_messages = vec![Message { role: "system".into(), content: system.into() }];
    all_messages.extend_from_slice(messages);

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": all_messages,
    });

    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", settings.api_key.expose_secret()))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("OpenAI request failed: {e}")))?;

    let res = check_response(res, "openai").await?;
    let resp: OpenAiResponse = res
        .json()
        .await
        .map_err(|e| AiError::Failed(format!("Failed to parse OpenAI response: {e}")))?;

    resp.choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .ok_or_else(|| AiError::Failed("Empty response from OpenAI".into()))
}

// ── Streaming API ────────────────────────────────────────────────────────

pub async fn ask_llm_stream(
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens_override: Option<u32>,
    tool: Option<&ToolDef>,
    tx: mpsc::Sender<String>,
) -> Result<String, AiError> {
    let client = &*HTTP_CLIENT;
    let max_tokens = max_tokens_override.unwrap_or(settings.max_tokens.unwrap_or(2048));

    match settings.provider.as_str() {
        "openai" => stream_openai(client, settings, system, messages, max_tokens, &tx).await,
        _ => stream_anthropic(client, settings, system, messages, max_tokens, tool, &tx).await,
    }
}

async fn stream_anthropic(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens: u32,
    tool: Option<&ToolDef>,
    tx: &mpsc::Sender<String>,
) -> Result<String, AiError> {
    let model = settings.model.as_deref().unwrap_or(ANTHROPIC_DEFAULT_MODEL);

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
        "stream": true,
    });

    // If tool provided, use tool_use for structured output
    if let Some(tool_def) = tool {
        body["tools"] = serde_json::json!([{
            "name": tool_def.name,
            "description": tool_def.description,
            "input_schema": tool_def.input_schema,
        }]);
        body["tool_choice"] = serde_json::json!({"type": "tool", "name": tool_def.name});
    }

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", settings.api_key.expose_secret())
        .header("anthropic-version", ANTHROPIC_API_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("Anthropic stream request failed: {e}")))?;

    let res = check_response(res, "anthropic").await?;

    // When using tool_use, deltas come as input_json_delta; otherwise text_delta
    let is_tool_use = tool.is_some();
    consume_sse_stream(res, tx, move |v| {
        if is_tool_use {
            // Tool use streaming: content_block_delta with input_json_delta
            v["delta"]["partial_json"].as_str()
                .or_else(|| v["delta"]["text"].as_str())
        } else {
            v["delta"]["text"].as_str()
        }
    }).await
}

async fn stream_openai(
    client: &reqwest::Client,
    settings: &AiSettings,
    system: &str,
    messages: &[Message],
    max_tokens: u32,
    tx: &mpsc::Sender<String>,
) -> Result<String, AiError> {
    let model = settings.model.as_deref().unwrap_or(OPENAI_DEFAULT_MODEL);

    let mut all_messages = vec![Message { role: "system".into(), content: system.into() }];
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

    let res = check_response(res, "openai").await?;
    consume_sse_stream(res, tx, |v| v["choices"][0]["delta"]["content"].as_str()).await
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

        // Proper UTF-8 handling (not lossy)
        let text = std::str::from_utf8(&chunk)
            .map_err(|e| AiError::Failed(format!("Invalid UTF-8 in stream: {e}")))?;
        buf.push_str(text);

        while let Some(pos) = buf.find("\n\n") {
            let event_block = buf[..pos].to_string();
            buf.drain(..pos + 2);

            for line in event_block.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" { continue; }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(text) = extract_text(&v) {
                            // Bounds check
                            if accumulated.len() + text.len() > MAX_RESPONSE_SIZE {
                                return Err(AiError::Failed("Response too large".into()));
                            }
                            accumulated.push_str(text);
                            let _ = tx.send(text.to_string()).await;
                        }
                    }
                }
            }
        }
    }

    Ok(accumulated)
}

// ── SSE infrastructure ───────────────────────────────────────────────────

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
            if tokio::time::timeout(
                Duration::from_secs(5),
                tx_fwd.send(Ok(Event::default().event("delta").data(delta))),
            ).await.is_err() {
                break; // Client disconnected
            }
        }
    });

    SseChannels { sse_tx, sse_rx, delta_tx }
}

pub fn into_sse_response(sse_rx: mpsc::Receiver<Result<Event, Infallible>>) -> Response {
    Sse::new(ReceiverStream::new(sse_rx))
        .keep_alive(KeepAlive::default())
        .into_response()
}

/// Stream an LLM call to SSE with optional tool_use for structured output.
pub fn stream_llm_to_sse(
    ai_settings: AiSettings,
    system_prompt: String,
    user_message: String,
    max_tokens: Option<u32>,
    tool: Option<ToolDef>,
    parse_result: impl FnOnce(&str) -> serde_json::Value + Send + 'static,
) -> Response {
    let ch = setup_sse_channels();
    let sse_tx = ch.sse_tx;
    let delta_tx = ch.delta_tx;

    tokio::spawn(async move {
        let msgs = [Message { role: "user".into(), content: user_message }];

        match ask_llm_stream(&ai_settings, &system_prompt, &msgs, max_tokens, tool.as_ref(), delta_tx).await {
            Ok(full_text) => {
                debug!("LLM stream completed ({} bytes)", full_text.len());
                let payload = parse_result(&full_text);
                let _ = sse_tx
                    .send(Ok(Event::default().event("complete").data(payload.to_string())))
                    .await;
            }
            Err(e) => {
                warn!("LLM stream failed: {e}");
                let err = serde_json::json!({"code": e.code(), "message": e.to_string()});
                let _ = sse_tx
                    .send(Ok(Event::default().event("error").data(err.to_string())))
                    .await;
            }
        }
    });

    into_sse_response(ch.sse_rx)
}
