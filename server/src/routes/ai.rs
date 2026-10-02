//! Every model call, relayed to the platform's AI gateway. The browser speaks
//! OpenAI chat completions to this route as it would to the gateway itself;
//! what the server adds is what the browser must not hold or decide: the
//! workspace's key, who is asking, and how much an answer may cost.

use axum::Json;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::Response;
use futures::StreamExt;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tracing::warn;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::Member;
use crate::configuration::AiSettings;
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::startup::AppState;

/// The gateway, and the one HTTP client every call goes out on.
pub struct Gateway {
    url: String,
    key: secrecy::SecretString,
    http: reqwest::Client,
}

impl Gateway {
    pub fn new(settings: AiSettings) -> Self {
        Self {
            url: settings.url,
            key: settings.key,
            // A connect timeout and no total one: an answer streams for as
            // long as the model writes it, bounded instead by `IDLE` between
            // two chunks.
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(5))
                .build()
                .expect("a TLS backend is compiled in"),
        }
    }
}

/// How long the gateway may send nothing — before its answer begins, or between
/// two chunks of it. Past it the call is `gateway/silent`: as the response, or as the stream's
/// last event once the answer has begun.
/// Under the browser's 30 s per chunk, so the gateway is named before the browser
/// gives up and can only name the server. The route is left out of the server's
/// request deadline, which this bound replaces for it.
pub const IDLE: Duration = Duration::from_secs(25);
/// The browser's bound on a model stream: `createGateway`'s idle, `@kanzo-tech/llm`.
const BROWSER_IDLE: Duration = Duration::from_secs(30);
const _: () = assert!(
    IDLE.as_secs() < BROWSER_IDLE.as_secs(),
    "the relay names the gateway before the browser gives up"
);

/// `chunks`, ended once `idle` passes without one: with `silence` as the last chunk when there is
/// one, or else with an I/O error.
fn until_idle<S>(
    chunks: S,
    idle: Duration,
    silence: Option<Bytes>,
) -> impl futures::Stream<Item = Result<Bytes, std::io::Error>>
where
    S: futures::Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    futures::stream::unfold(Some((chunks, silence)), move |state| async move {
        let (mut chunks, silence) = state?;
        match tokio::time::timeout(idle, chunks.next()).await {
            Ok(Some(Ok(chunk))) => Some((Ok(chunk), Some((chunks, silence)))),
            Ok(Some(Err(e))) => Some((Err(std::io::Error::other(e)), None)),
            Ok(None) => None,
            Err(_) => {
                warn!(
                    after_ms = idle.as_millis() as u64,
                    "AI gateway went silent mid-answer"
                );
                let last = silence.ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "the AI gateway sent nothing within its deadline",
                    )
                });
                Some((last, None))
            }
        }
    })
}

/// `body` as the chat completions stream's error event — `data: {"error": {"message": …}}`, the
/// chunk an OpenAI-compatible client reads as a failure rather than as more answer — with the
/// body's own fields beside `message`. It opens with a blank line, so a chunk the gateway left
/// half-written cannot swallow it.
///
/// The 200 and its headers are already sent when a stream goes quiet, so a status cannot say it;
/// cutting the connection would leave the browser a network error and nothing to name.
fn error_event(body: &ErrorBody) -> Bytes {
    let mut error = serde_json::to_value(body).expect("an ErrorBody serializes");
    error["message"] = json!(body.detail);
    Bytes::from(format!("\n\ndata: {}\n\n", json!({ "error": error })))
}

/// A model, by what it is for. Which upstream answers is the gateway's
/// configuration (`infra/ai/`), so nothing here names a provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Alias {
    /// Conversations and generation: the Ask panel, the job assistant.
    Chat,
    /// Assisted fields: short, fast, often the same question twice.
    Complete,
}

impl Alias {
    /// The most tokens one answer may take — the ceiling a page cannot raise.
    fn cap(self) -> u32 {
        match self {
            Self::Chat => 4096,
            Self::Complete => 512,
        }
    }
}

/// An OpenAI chat completion request. `model` must be an alias; everything
/// else the protocol carries — `stream`, `tools`, `response_format`,
/// `temperature` — goes to the gateway untouched.
#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ChatCompletionRequest {
    pub model: Alias,
    /// The conversation, in the OpenAI message format.
    #[schema(value_type = Vec<Object>)]
    pub messages: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_completion_tokens: Option<u32>,
    #[serde(flatten)]
    #[schema(ignore)]
    pub rest: Map<String, Value>,
}

#[utoipa::path(post, path = "/v1/ai/chat/completions", tag = "AI",
    request_body = ChatCompletionRequest,
    responses(
        (status = 200, description = "The gateway's answer as it streams: OpenAI chat completion chunks (`text/event-stream`), ended by an error event carrying `gateway/silent` if the gateway goes quiet mid-answer, or one completion (`application/json`)"),
        (status = 400, description = "Not an alias, or a malformed request", body = ErrorBody),
        (status = 502, description = "The AI gateway could not be reached", body = ErrorBody),
        (status = 504, description = "The AI gateway did not begin its answer in time", body = ErrorBody),
        (status = 503, description = "This workspace has no AI gateway", body = ErrorBody),
    )
)]
/// Relay one chat completion to the gateway. The answer is streamed back as
/// the gateway sends it, byte for byte; a reader who leaves drops the stream,
/// and with it the upstream request. A refusal of the gateway's own — a spent
/// budget, an upstream failure — arrives in the protocol's error format, with
/// its status.
pub async fn chat_completions(
    member: Member,
    State(state): State<AppState>,
    Json(mut request): Json<ChatCompletionRequest>,
) -> Result<Response, Refusal> {
    let gateway = state.ai.as_ref().ok_or_else(|| {
        Refusal::new(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::AiNotConfigured,
            "this workspace has no AI gateway (KEASY_AI_URL)",
        )
    })?;

    let cap = request.model.cap();
    request.max_tokens = Some(request.max_tokens.map_or(cap, |n| n.min(cap)));
    request.max_completion_tokens = request.max_completion_tokens.map(|n| n.min(cap));
    // Who is asking is ours to say, and so is what may be cached.
    request.rest.remove("user");
    request.rest.remove("cache");
    let mut body = serde_json::to_value(&request).map_err(|e| Refusal::invalid(e.to_string()))?;
    body["user"] = json!(member.user_id);
    if request.model == Alias::Complete {
        // The gateway caches nothing unless asked; a field asks the same
        // question often, and a conversation never twice on purpose.
        body["cache"] = json!({ "use-cache": true });
    }

    relay(gateway, &body, IDLE).await
}

/// Send `body` to the gateway and stream its answer back, every wait bounded by `idle`.
async fn relay(gateway: &Gateway, body: &Value, idle: Duration) -> Result<Response, Refusal> {
    let sent = gateway
        .http
        .post(format!("{}/v1/chat/completions", gateway.url))
        .bearer_auth(gateway.key.expose_secret())
        .json(body)
        .send();
    let upstream = tokio::time::timeout(idle, sent)
        .await
        .map_err(|_| {
            Refusal::Body(
                StatusCode::GATEWAY_TIMEOUT,
                ErrorBody::silent(
                    ErrorCode::AiSilent,
                    "the AI gateway did not begin its answer within its deadline",
                    idle,
                ),
            )
        })?
        .map_err(|e| {
            warn!("AI gateway unreachable: {e}");
            Refusal::new(
                StatusCode::BAD_GATEWAY,
                ErrorCode::AiUnreachable,
                "the AI gateway could not be reached",
            )
        })?;

    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or(header::HeaderValue::from_static("application/json"));
    // Only an answer that streams has a place to say it went quiet; a JSON body is cut.
    let streams =
        upstream.status().is_success() && content_type.as_bytes().starts_with(b"text/event-stream");
    let silence = streams.then(|| {
        error_event(&ErrorBody::silent(
            ErrorCode::AiSilent,
            "the AI gateway went silent mid-answer",
            idle,
        ))
    });
    Response::builder()
        .status(upstream.status())
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(until_idle(
            upstream.bytes_stream(),
            idle,
            silence,
        )))
        .map_err(|e| {
            Refusal::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorCode::InternalError,
                e.to_string(),
            )
        })
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(chat_completions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::configuration::AiSettings;

    fn gateway(url: String) -> Gateway {
        Gateway::new(AiSettings {
            url,
            key: secrecy::SecretString::from("k"),
        })
    }

    const SHORT: Duration = Duration::from_millis(300);

    #[tokio::test]
    async fn a_gateway_that_accepts_and_never_answers_is_gateway_silent() {
        let held = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", held.local_addr().unwrap());
        let started = std::time::Instant::now();
        let refused = relay(&gateway(url), &json!({}), SHORT).await.unwrap_err();
        let response = axum::response::IntoResponse::into_response(refused);
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        let body: Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(body["code"], "gateway/silent");
        assert_eq!(body["data"]["after"], 300);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    /// A gateway that answers `content_type` with one chunk, then nothing.
    async fn quiet_after_one_chunk(content_type: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let app = axum::Router::new().fallback(move || async move {
            let first = futures::stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
            ))]);
            Response::builder()
                .header(header::CONTENT_TYPE, content_type)
                .body(Body::from_stream(first.chain(futures::stream::pending())))
                .unwrap()
        });
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        url
    }

    #[tokio::test]
    async fn a_gateway_that_goes_quiet_mid_answer_ends_the_stream_with_gateway_silent() {
        let url = quiet_after_one_chunk("text/event-stream").await;
        let response = relay(&gateway(url), &json!({}), SHORT).await.unwrap();
        let mut body = response.into_body().into_data_stream();
        assert!(
            body.next().await.unwrap().is_ok(),
            "what came before the silence is relayed"
        );
        let started = std::time::Instant::now();
        let last = body
            .next()
            .await
            .unwrap()
            .expect("the silence is an event, not a cut");
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(body.next().await.is_none(), "the event ends the stream");

        let text = std::str::from_utf8(&last).unwrap();
        assert!(
            text.starts_with("\n\ndata: ") && text.ends_with("\n\n"),
            "one SSE event, on its own: {text:?}"
        );
        let event: Value =
            serde_json::from_str(text.trim().strip_prefix("data: ").unwrap()).unwrap();
        // What an OpenAI-compatible client requires of an error chunk: an `error` with a `message`,
        // and no `choices`.
        assert!(event.get("choices").is_none());
        assert_eq!(event["error"]["message"], event["error"]["detail"]);
        assert_eq!(event["error"]["code"], "gateway/silent");
        assert_eq!(event["error"]["data"]["after"], 300);
    }

    #[tokio::test]
    async fn a_json_answer_that_goes_quiet_is_cut() {
        let url = quiet_after_one_chunk("application/json").await;
        let response = relay(&gateway(url), &json!({}), SHORT).await.unwrap();
        let mut body = response.into_body().into_data_stream();
        assert!(body.next().await.unwrap().is_ok());
        assert!(
            body.next().await.unwrap().is_err(),
            "a JSON body has no place for an event, so the silence ends it as an error"
        );
    }

    #[tokio::test]
    async fn an_unreachable_gateway_is_gateway_unreachable() {
        let refused = relay(&gateway("http://127.0.0.1:1".into()), &json!({}), SHORT)
            .await
            .unwrap_err();
        let response = axum::response::IntoResponse::into_response(refused);
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }
}
