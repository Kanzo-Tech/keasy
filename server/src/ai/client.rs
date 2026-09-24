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

use crate::db::{DbError, DbResult};
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

#[derive(Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(reqwest::Client::new);

/// Why an ask has no provider to run on.
pub enum AiUnavailable {
    NotConfigured,
    Db(DbError),
}

impl IntoResponse for AiUnavailable {
    fn into_response(self) -> Response {
        match self {
            AiUnavailable::NotConfigured => (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(crate::error::error_body(
                    "ai_not_configured",
                    "AI settings are not configured. Go to Settings > AI to add an API key.",
                )),
            )
                .into_response(),
            AiUnavailable::Db(e) => e.into_response(),
        }
    }
}

/// The provider an ask runs on: configured, and holding a key.
pub fn require_ai_settings(
    settings: DbResult<Option<AiSettings>>,
) -> Result<AiSettings, AiUnavailable> {
    match settings.map_err(AiUnavailable::Db)? {
        Some(s) if !s.api_key.expose_secret().is_empty() => Ok(s),
        _ => Err(AiUnavailable::NotConfigured),
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
    let model = settings
        .model
        .as_deref()
        .unwrap_or("claude-sonnet-4-20250514");

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
        .header(
            "Authorization",
            format!("Bearer {}", settings.api_key.expose_secret()),
        )
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
                    if data == "[DONE]" {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(data)
                        && let Some(text) = extract_text(&v)
                    {
                        accumulated.push_str(text);
                        let _ = tx.send(text.to_string()).await;
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

    SseChannels {
        sse_tx,
        sse_rx,
        delta_tx,
    }
}

/// The `code` an `error` frame carries for a failed model call.
pub fn failure_code(e: &AiError) -> &'static str {
    match e {
        AiError::InsufficientCredits(_) => "insufficient_credits",
        AiError::Failed(_) => "llm_failed",
    }
}

/// The one shape of the `error` frame. Both stream endpoints go through here so
/// the payload cannot drift into two spellings again.
pub fn error_event(code: &str, message: &str) -> Event {
    Event::default()
        .event("error")
        .data(serde_json::json!({"code": code, "message": message}).to_string())
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
                    .send(Ok(Event::default()
                        .event("complete")
                        .data(payload.to_string())))
                    .await;
            }
            Err(e) => {
                warn!("LLM stream failed: {e}");
                let _ = sse_tx
                    .send(Ok(error_event(failure_code(&e), &e.to_string())))
                    .await;
            }
        }
    });

    into_sse_response(ch.sse_rx)
}
