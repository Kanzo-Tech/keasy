use std::convert::Infallible;
use std::fmt;
use std::time::Duration;

use axum::response::sse::Event;
use futures::StreamExt;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::domain::{ModelCredentialInput, ModelTarget};
use crate::error::{ErrorBody, ErrorCode};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    User,
    Assistant,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

pub type SseSender = mpsc::Sender<Result<Event, Infallible>>;

#[derive(Debug)]
pub enum AiError {
    InsufficientCredits(String),
    Failed(String),
    /// The provider sent nothing for `after`: before its answer began, or
    /// in the middle of it.
    Silent {
        provider: &'static str,
        after: Duration,
    },
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AiError::InsufficientCredits(msg) | AiError::Failed(msg) => f.write_str(msg),
            AiError::Silent { provider, after } => {
                write!(f, "{provider} sent nothing for {} s", after.as_secs_f64())
            }
        }
    }
}

impl AiError {
    /// The body of the `error` frame, the same shape a refused request gets.
    pub fn body(&self) -> ErrorBody {
        match self {
            AiError::InsufficientCredits(_) => {
                ErrorBody::new(ErrorCode::InsufficientCredits, self.to_string(), Vec::new())
            }
            AiError::Failed(_) => {
                ErrorBody::new(ErrorCode::LlmFailed, self.to_string(), Vec::new())
            }
            AiError::Silent { after, .. } => {
                ErrorBody::silent(ErrorCode::LlmSilent, self.to_string(), *after)
            }
        }
    }

    /// The `error` frame.
    pub fn event(&self) -> Event {
        Event::default()
            .event("error")
            .data(serde_json::to_string(&self.body()).expect("an ErrorBody serializes"))
    }
}

/// How long a provider may send nothing — before its answer begins, or
/// between two chunks of it — before the call is cut as `llm/silent`.
pub const IDLE: Duration = Duration::from_secs(30);

static HTTP_CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
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
    // An error body that is not JSON is still an answer: its text is the message.
    let text = res.text().await.unwrap_or_default();
    let body: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let message = body["error"]["message"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| match text.trim() {
            "" => format!("{provider} answered {status} with no body"),
            t => t.chars().take(300).collect(),
        });
    let message = message.as_str();
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
    stream_within(credential, target, system, messages, max_tokens, tx, IDLE).await
}

async fn stream_within(
    credential: &ModelCredentialInput,
    target: &ModelTarget,
    system: &str,
    messages: &[ChatMessage],
    max_tokens: Option<u32>,
    tx: &SseSender,
    idle: Duration,
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

    let silent = AiError::Silent {
        provider,
        after: idle,
    };
    let res = tokio::time::timeout(idle, request.send())
        .await
        .map_err(|_| AiError::Silent {
            provider,
            after: idle,
        })?
        .map_err(|e| AiError::Failed(format!("{provider} request failed: {e}")))?;
    if !res.status().is_success() {
        return Err(classify_api_error(res, provider).await);
    }

    let mut body = res.bytes_stream();
    let mut frames = Frames::default();
    loop {
        let chunk = match tokio::time::timeout(idle, body.next()).await {
            Err(_) => return Err(silent),
            Ok(None) => break,
            Ok(Some(chunk)) => {
                chunk.map_err(|e| AiError::Failed(format!("Stream read error: {e}")))?
            }
        };
        for frame in frames.push(&chunk) {
            match read_frame(credential, provider, &frame)? {
                Read::Text(delta) => {
                    // A reader who left is not this call's failure: the
                    // caller's select sees the closed channel and drops it.
                    let _ = tx
                        .send(Ok(Event::default().event("delta").data(delta)))
                        .await;
                }
                Read::Finished => return Ok(()),
                Read::Nothing => {}
            }
        }
    }
    Err(AiError::Failed(format!(
        "{provider} closed the stream before the answer finished"
    )))
}

/// What one SSE frame from a provider says.
#[derive(Debug, PartialEq)]
enum Read {
    Text(String),
    /// The provider said the answer is complete: Anthropic's `message_stop`,
    /// OpenAI's `[DONE]` or a `finish_reason`.
    Finished,
    Nothing,
}

/// One frame, as `event` and `data` lines. A provider's error event mid-stream
/// — Anthropic's `event: error` (`overloaded_error`, …), OpenAI's `{"error":…}`
/// — is a failure, never a short answer.
fn read_frame(
    credential: &ModelCredentialInput,
    provider: &str,
    frame: &str,
) -> Result<Read, AiError> {
    let mut event = None;
    let mut data = String::new();
    for line in frame.lines() {
        if let Some(name) = line.strip_prefix("event:") {
            event = Some(name.trim());
        } else if let Some(d) = line.strip_prefix("data:") {
            data.push_str(d.strip_prefix(' ').unwrap_or(d));
        }
    }
    if data.is_empty() {
        return Ok(Read::Nothing);
    }
    if data == "[DONE]" {
        return Ok(Read::Finished);
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) else {
        return Ok(Read::Nothing);
    };
    if event == Some("error")
        || v["type"] == "error"
        || v.get("error").is_some_and(|e| !e.is_null())
    {
        let message = v["error"]["message"]
            .as_str()
            .or_else(|| v["error"].as_str())
            .unwrap_or("the provider reported an error");
        let kind = v["error"]["type"].as_str().unwrap_or("error");
        return Err(AiError::Failed(format!(
            "{message} ({provider}, {kind}, mid-stream)"
        )));
    }
    let (text, finished) = match credential {
        ModelCredentialInput::Anthropic { .. } => {
            (v["delta"]["text"].as_str(), v["type"] == "message_stop")
        }
        ModelCredentialInput::Openai { .. } => (
            v["choices"][0]["delta"]["content"].as_str(),
            v["choices"][0]["finish_reason"].is_string(),
        ),
    };
    Ok(match (text, finished) {
        (Some(t), _) if !t.is_empty() => Read::Text(t.to_owned()),
        (_, true) => Read::Finished,
        _ => Read::Nothing,
    })
}

/// A byte stream cut into SSE frames. Bytes are kept until a frame is whole,
/// so a character split across two network chunks is decoded once, whole.
#[derive(Default)]
struct Frames {
    buf: Vec<u8>,
}

impl Frames {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(end) = frame_end(&self.buf) {
            let (len, sep) = end;
            let frame: Vec<u8> = self.buf.drain(..len + sep).take(len).collect();
            out.push(String::from_utf8_lossy(&frame).replace('\r', ""));
        }
        out
    }
}

/// Where the first frame ends, and the length of the blank line that ends it.
fn frame_end(buf: &[u8]) -> Option<(usize, usize)> {
    let lf = buf.windows(2).position(|w| w == b"\n\n").map(|i| (i, 2));
    let crlf = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| (i, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (a, b) => a.or(b),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use secrecy::SecretString;

    fn openai(base_url: &str) -> ModelCredentialInput {
        ModelCredentialInput::Openai {
            api_key: SecretString::from("k"),
            base_url: Some(base_url.to_string()),
        }
    }

    fn anthropic() -> ModelCredentialInput {
        ModelCredentialInput::Anthropic {
            api_key: SecretString::from("k"),
        }
    }

    /// A provider that sends `chunks`, then holds the connection open.
    async fn provider(chunks: Vec<&'static str>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new().fallback(move || {
            let chunks = chunks.clone();
            async move {
                let sent = futures::stream::iter(
                    chunks
                        .into_iter()
                        .map(|c| Ok::<_, std::io::Error>(axum::body::Bytes::from(c))),
                )
                .chain(futures::stream::pending());
                axum::response::Response::builder()
                    .header("content-type", "text/event-stream")
                    .body(Body::from_stream(sent))
                    .unwrap()
            }
        });
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        url
    }

    async fn call(credential: &ModelCredentialInput) -> (Result<(), AiError>, Vec<String>) {
        let (tx, mut rx) = mpsc::channel(32);
        let target = ModelTarget {
            model: None,
            max_tokens: None,
        };
        let out = stream_within(
            credential,
            &target,
            "s",
            &[],
            None,
            &tx,
            Duration::from_millis(300),
        )
        .await;
        drop(tx);
        let mut frames = Vec::new();
        while let Some(Ok(event)) = rx.recv().await {
            frames.push(format!("{event:?}"));
        }
        (out, frames)
    }

    #[tokio::test]
    async fn a_provider_that_goes_quiet_mid_answer_is_cut_as_silent() {
        let url = provider(vec![
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
        ])
        .await;
        let started = std::time::Instant::now();
        let (out, frames) = call(&openai(&url)).await;
        let err = out.unwrap_err();
        let body = err.body();
        assert_eq!(body.code, ErrorCode::LlmSilent);
        assert_eq!(body.data.after, Some(300));
        assert_eq!(
            frames.len(),
            2,
            "what arrived before the silence was relayed"
        );
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[tokio::test]
    async fn a_provider_that_never_starts_is_silent_too() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (out, _) = call(&openai(&url)).await;
        assert_eq!(out.unwrap_err().body().code, ErrorCode::LlmSilent);
    }

    #[tokio::test]
    async fn an_error_event_mid_stream_is_a_failure_not_a_short_answer() {
        let url = provider(vec![
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
            "data: {\"error\":{\"message\":\"overloaded\",\"type\":\"server_error\"}}\n\n",
        ])
        .await;
        let (out, _) = call(&openai(&url)).await;
        let body = out.unwrap_err().body();
        assert_eq!(body.code, ErrorCode::LlmFailed);
        assert!(body.detail.contains("overloaded"), "{}", body.detail);
    }

    #[test]
    fn anthropic_overloaded_error_event_is_recognized() {
        let frame = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}";
        let err = read_frame(&anthropic(), "anthropic", frame).unwrap_err();
        assert!(err.to_string().contains("overloaded_error"), "{err}");
        assert_eq!(
            read_frame(
                &anthropic(),
                "anthropic",
                "event: message_stop\ndata: {\"type\":\"message_stop\"}"
            )
            .unwrap(),
            Read::Finished
        );
    }

    #[tokio::test]
    async fn a_stream_that_closes_before_the_answer_finished_is_a_failure() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new()
            .fallback(|| async { "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n" });
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let (out, _) = call(&openai(&url)).await;
        assert_eq!(out.unwrap_err().body().code, ErrorCode::LlmFailed);
    }

    #[test]
    fn a_character_split_across_chunks_is_decoded_whole() {
        let frame = "data: {\"choices\":[{\"delta\":{\"content\":\"é\"}}]}\n\n".as_bytes();
        let split = frame.iter().position(|&b| b == 0xC3).unwrap() + 1;
        let mut frames = Frames::default();
        assert!(frames.push(&frame[..split]).is_empty());
        let out = frames.push(&frame[split..]);
        assert_eq!(out.len(), 1);
        assert_eq!(
            read_frame(&openai("x"), "openai", &out[0]).unwrap(),
            Read::Text("é".into())
        );
    }
}
