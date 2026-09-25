use std::convert::Infallible;
use std::fmt;

use axum::response::sse::Event;
use axum::response::{IntoResponse, Response};
use futures::StreamExt;
use secrecy::ExposeSecret;
use tokio::sync::mpsc;

use crate::db::{DbError, DbResult};
use keasy_api::ai::ChatMessage;
use keasy_api::settings::ai::AiProvider;
use keasy_api::{ErrorBody, ErrorCode};

use crate::settings::ai::AiSettings;

pub type SseSender = mpsc::Sender<Result<Event, Infallible>>;

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

impl AiError {
    /// The `error` frame: an [`ErrorBody`], the same shape a refused request gets.
    pub fn event(&self) -> Event {
        let error = match self {
            AiError::InsufficientCredits(_) => ErrorCode::InsufficientCredits,
            AiError::Failed(_) => ErrorCode::LlmFailed,
        };
        let body = ErrorBody {
            error,
            message: self.to_string(),
        };
        Event::default()
            .event("error")
            .data(serde_json::to_string(&body).expect("an ErrorBody serializes"))
    }
}

static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> =
    std::sync::LazyLock::new(reqwest::Client::new);

/// Why a call has no provider to run on.
pub enum AiUnavailable {
    NotConfigured,
    Db(DbError),
}

impl IntoResponse for AiUnavailable {
    fn into_response(self) -> Response {
        match self {
            AiUnavailable::NotConfigured => crate::error::fail(
                axum::http::StatusCode::BAD_REQUEST,
                ErrorCode::AiNotConfigured,
                "AI settings are not configured. Go to Settings > AI to add an API key.",
            ),
            AiUnavailable::Db(e) => e.into_response(),
        }
    }
}

/// The provider a call runs on: configured, and holding a key.
pub fn require_ai_settings(
    settings: DbResult<Option<AiSettings>>,
) -> Result<AiSettings, AiUnavailable> {
    match settings.map_err(AiUnavailable::Db)? {
        Some(s) if !s.api_key.expose_secret().is_empty() => Ok(s),
        _ => Err(AiUnavailable::NotConfigured),
    }
}

async fn classify_api_error(res: reqwest::Response, provider: AiProvider) -> AiError {
    let provider = provider.as_ref();
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

/// Call the provider and relay each text chunk it streams as a `delta` frame.
pub async fn stream(
    settings: &AiSettings,
    system: &str,
    messages: &[ChatMessage],
    max_tokens: Option<u32>,
    tx: &SseSender,
) -> Result<(), AiError> {
    let provider = settings.provider;
    let model = settings
        .model
        .as_deref()
        .unwrap_or(provider.default_model());
    let max_tokens = max_tokens.or(settings.max_tokens).unwrap_or(2048);
    let key = settings.api_key.expose_secret();

    let request = match provider {
        AiProvider::Anthropic => HTTP_CLIENT
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .json(&serde_json::json!({
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages,
                "stream": true,
            })),
        AiProvider::Openai => {
            let mut all = vec![serde_json::json!({ "role": "system", "content": system })];
            all.extend(messages.iter().map(|m| serde_json::json!(m)));
            HTTP_CLIENT
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(key)
                .json(&serde_json::json!({
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": all,
                    "stream": true,
                }))
        }
    };

    let res = request
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("{} request failed: {e}", provider.as_ref())))?;
    if !res.status().is_success() {
        return Err(classify_api_error(res, provider).await);
    }

    let text = |v: &serde_json::Value| -> Option<String> {
        match provider {
            AiProvider::Anthropic => v["delta"]["text"].as_str(),
            AiProvider::Openai => v["choices"][0]["delta"]["content"].as_str(),
        }
        .map(str::to_owned)
    };

    let mut body = res.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| AiError::Failed(format!("Stream read error: {e}")))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find("\n\n") {
            for line in buf[..pos].lines() {
                let Some(data) = line.strip_prefix("data: ") else {
                    continue;
                };
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data)
                    && let Some(delta) = text(&v)
                    && !delta.is_empty()
                {
                    let _ = tx.send(Ok(Event::default().event("delta").data(delta))).await;
                }
            }
            buf.drain(..pos + 2);
        }
    }
    Ok(())
}
