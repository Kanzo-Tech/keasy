use std::convert::Infallible;
use std::fmt;
use std::time::Duration;

use axum::response::sse::Event;
use futures::StreamExt;
use secrecy::ExposeSecret;
use tokio::sync::mpsc;

use keasy_api::ai::ChatMessage;
use keasy_api::connections::ModelTarget;
use keasy_api::credentials::ModelCredentialInput;
use keasy_api::{ErrorBody, ErrorCode};

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
            dependents: Vec::new(),
        };
        Event::default()
            .event("error")
            .data(serde_json::to_string(&body).expect("an ErrorBody serializes"))
    }
}

static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("a default HTTP client builds")
});

const ANTHROPIC: &str = "https://api.anthropic.com/v1";
const OPENAI: &str = "https://api.openai.com/v1";
const ANTHROPIC_VERSION: &str = "2023-06-01";

fn name(credential: &ModelCredentialInput) -> &'static str {
    match credential {
        ModelCredentialInput::Anthropic { .. } => "anthropic",
        ModelCredentialInput::Openai { .. } => "openai",
    }
}

/// A request to `path` under the provider's API, carrying the key.
fn request(
    credential: &ModelCredentialInput,
    method: reqwest::Method,
    path: &str,
) -> reqwest::RequestBuilder {
    match credential {
        ModelCredentialInput::Anthropic { api_key } => HTTP_CLIENT
            .request(method, format!("{ANTHROPIC}{path}"))
            .header("x-api-key", api_key.expose_secret())
            .header("anthropic-version", ANTHROPIC_VERSION),
        ModelCredentialInput::Openai { api_key, base_url } => {
            let base = base_url.as_deref().unwrap_or(OPENAI).trim_end_matches('/');
            HTTP_CLIENT
                .request(method, format!("{base}{path}"))
                .bearer_auth(api_key.expose_secret())
        }
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

/// The ids of the models the key may call: the provider's `GET /models`.
pub async fn models(credential: &ModelCredentialInput) -> Result<Vec<String>, String> {
    let provider = name(credential);
    let path = match credential {
        ModelCredentialInput::Anthropic { .. } => "/models?limit=1000",
        ModelCredentialInput::Openai { .. } => "/models",
    };
    let res = request(credential, reqwest::Method::GET, path)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("{provider} did not answer: {e}"))?;
    if !res.status().is_success() {
        return Err(classify_api_error(res, provider).await.to_string());
    }
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("{provider} answered with no model list: {e}"))?;
    Ok(body["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str().map(str::to_owned))
        .collect())
}

/// Call the provider and relay each text chunk it streams as a `delta` frame.
pub async fn stream(
    credential: &ModelCredentialInput,
    target: &ModelTarget,
    system: &str,
    messages: &[ChatMessage],
    max_tokens: Option<u32>,
    tx: &SseSender,
) -> Result<(), AiError> {
    let provider = name(credential);
    let model = target
        .model
        .as_deref()
        .unwrap_or(credential.default_model());
    let max_tokens = match (max_tokens, target.max_tokens) {
        (Some(asked), Some(cap)) => asked.min(cap),
        (asked, cap) => asked.or(cap).unwrap_or(2048),
    };

    let request = match credential {
        ModelCredentialInput::Anthropic { .. } => {
            request(credential, reqwest::Method::POST, "/messages").json(&serde_json::json!({
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages,
                "stream": true,
            }))
        }
        ModelCredentialInput::Openai { .. } => {
            let mut all = vec![serde_json::json!({ "role": "system", "content": system })];
            all.extend(messages.iter().map(|m| serde_json::json!(m)));
            request(credential, reqwest::Method::POST, "/chat/completions").json(
                &serde_json::json!({
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": all,
                    "stream": true,
                }),
            )
        }
    };

    let res = request
        .send()
        .await
        .map_err(|e| AiError::Failed(format!("{provider} request failed: {e}")))?;
    if !res.status().is_success() {
        return Err(classify_api_error(res, provider).await);
    }

    let text = |v: &serde_json::Value| -> Option<String> {
        match credential {
            ModelCredentialInput::Anthropic { .. } => v["delta"]["text"].as_str(),
            ModelCredentialInput::Openai { .. } => v["choices"][0]["delta"]["content"].as_str(),
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
                    let _ = tx
                        .send(Ok(Event::default().event("delta").data(delta)))
                        .await;
                }
            }
            buf.drain(..pos + 2);
        }
    }
    Ok(())
}
