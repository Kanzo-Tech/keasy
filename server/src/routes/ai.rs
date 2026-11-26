//! Every call of Ask and the assistant to the workspace's external model,
//! relayed. The browser speaks OpenAI chat completions to this route as it
//! would to the provider itself; what the server adds is what the browser must
//! not hold or decide: the key, which model, and how much an answer may cost.
//! It is the relay keasy had before October, its gateway now the admin's choice
//! (`/v1/ai/model`).

use std::sync::LazyLock;
use std::time::{Duration, Instant};

use axum::Json;
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::header;
use axum::response::Response;
use futures::StreamExt;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tracing::{info, warn};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::ai_model::{self, AiModel};
use crate::authentication::role::{Admin, Reader};
use crate::error::{Problem, Refusal, ServerCode};
use crate::routes::ai_model::{SetAiModelRequest, base_url, model};
use crate::startup::{AppState, REQUEST_DEADLINE};

/// The one HTTP client every call goes out on. A connect timeout and no total
/// one: an answer streams for as long as the model writes it, bounded instead
/// by [`IDLE`] between two chunks.
static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .expect("a TLS backend is compiled in")
});

/// How long the provider may send nothing: before its answer begins, or
/// between two chunks of it. Past it the call is `ai/silent`, as the response
/// or as the stream's last event once the answer has begun. Under the server's
/// own request deadline, so the provider is named before the server has to name
/// itself; that deadline bounds the headers only, and the stream runs past it.
pub const IDLE: Duration = Duration::from_secs(20);
const _: () = assert!(
    IDLE.as_millis() < REQUEST_DEADLINE.as_millis(),
    "the relay names the provider before the request deadline fires"
);

/// The most tokens one answer may take: the ceiling a page cannot raise.
pub const CAP: u32 = 4096;

/// Where a call goes: the stored model, or one an admin is about to store.
pub struct Upstream {
    pub base_url: String,
    pub model: String,
    pub key: Option<SecretString>,
}

impl From<AiModel> for Upstream {
    fn from(m: AiModel) -> Self {
        Self {
            base_url: m.base_url,
            model: m.model,
            key: m.api_key,
        }
    }
}

/// An OpenAI chat completion request. `model` is the workspace's, whatever the
/// page names; everything else the protocol carries (`stream`, `tools`,
/// `response_format`, `temperature`) goes to the provider untouched.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatCompletionRequest {
    /// Ignored: the workspace's model answers.
    #[serde(default, skip_serializing)]
    pub model: Option<String>,
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

impl ChatCompletionRequest {
    /// The body the provider is sent: the workspace's model, a limit no
    /// higher than [`CAP`], and no `user` of the page's own.
    fn body(mut self, model: &str) -> Result<Value, Refusal> {
        self.max_tokens = self.max_tokens.map(|n| n.min(CAP));
        self.max_completion_tokens = self.max_completion_tokens.map(|n| n.min(CAP));
        self.rest.remove("user");
        let mut body = serde_json::to_value(&self).map_err(|e| Refusal::invalid(e.to_string()))?;
        body["model"] = json!(model);
        Ok(body)
    }
}

#[utoipa::path(post, path = "/v1/ai/chat/completions", tag = "AI", security(("bearer" = ["reader"])),
    request_body = ChatCompletionRequest,
    responses(
        (status = 200, description = "The provider's answer as it streams: OpenAI chat completion chunks (`text/event-stream`), ended by an error event carrying `ai/silent` if the provider goes quiet mid-answer; or one completion (`application/json`)"),
        (status = 409, description = "No external model is set", body = Problem, content_type = "application/problem+json"),
        (status = 502, description = "The provider could not be reached, or refused", body = Problem, content_type = "application/problem+json"),
        (status = 504, description = "The provider did not begin its answer in time", body = Problem, content_type = "application/problem+json"),
    )
)]
/// Relay one chat completion to the workspace's model, for any member. The
/// answer streams back as the provider sends it, byte for byte; a reader who
/// leaves drops the stream, and with it the call to the provider.
pub async fn chat_completions(
    caller: Reader,
    State(state): State<AppState>,
    Json(request): Json<ChatCompletionRequest>,
) -> Result<Response, Refusal> {
    let db = &state.db;
    let stored = ai_model::get(&*db.read().await, db.secret_key())?.ok_or_else(|| {
        Refusal::new(
            ServerCode::AiNotConfigured,
            "No external model is set: Ask runs in the browser",
        )
    })?;
    let upstream = Upstream::from(stored);
    let body = request.body(&upstream.model)?;
    info!(user = %caller.user_id, model = %upstream.model, "AI call relayed");
    relay(&upstream, &body, IDLE).await
}

/// The call that answered, its time to answer.
#[derive(Debug, Serialize, ToSchema)]
pub struct AiModelTested {
    /// How long the provider took to answer, in milliseconds.
    pub latency_ms: u64,
}

#[utoipa::path(post, path = "/v1/ai/model/test", tag = "AI", security(("bearer" = ["admin"])),
    request_body = SetAiModelRequest,
    responses(
        (status = 200, description = "The model answered", body = AiModelTested),
        (status = 400, description = "Not an http(s) root, or no model", body = Problem, content_type = "application/problem+json"),
        (status = 502, description = "The provider could not be reached, or refused: a wrong key, an unknown model", body = Problem, content_type = "application/problem+json"),
        (status = 504, description = "The provider did not answer in time", body = Problem, content_type = "application/problem+json"),
    )
)]
/// An admin tries a model before saving it: one short question, its answer
/// discarded. Nothing is stored. With no `api_key` the stored key is tried,
/// as a save would keep it.
pub async fn test_ai_model(
    _: Admin,
    State(state): State<AppState>,
    Json(request): Json<SetAiModelRequest>,
) -> Result<Json<AiModelTested>, Refusal> {
    let base_url = base_url(&request.base_url)?;
    let model = model(&request.model)?;
    let key = match request.api_key {
        None => {
            let db = &state.db;
            ai_model::get(&*db.read().await, db.secret_key())?.and_then(|m| m.api_key)
        }
        Some(key) => {
            let key = key.expose_secret().trim();
            (!key.is_empty()).then(|| SecretString::from(key))
        }
    };
    let upstream = Upstream {
        base_url,
        model,
        key,
    };
    let latency = probe(&upstream, IDLE).await?;
    Ok(Json(AiModelTested {
        latency_ms: latency.as_millis() as u64,
    }))
}

/// Ask `upstream` one short question; how long it took to answer.
async fn probe(upstream: &Upstream, idle: Duration) -> Result<Duration, Refusal> {
    let body = json!({
        "model": upstream.model,
        "messages": [{ "role": "user", "content": "Reply with OK." }],
        "stream": false,
    });
    let started = Instant::now();
    let response = send(upstream, &body, idle).await?;
    let answer: Value = tokio::time::timeout(idle, response.json())
        .await
        .map_err(|_| silent("the AI provider did not finish its answer in time", idle))?
        .map_err(|_| refused("the provider answered, but not with JSON"))?;
    if answer.get("choices").and_then(Value::as_array).is_none() {
        return Err(refused(
            "the provider answered, but not with a chat completion",
        ));
    }
    Ok(started.elapsed())
}

fn silent(detail: &str, idle: Duration) -> Refusal {
    Refusal::silent(ServerCode::AiSilent, detail, idle)
}

fn refused(detail: impl Into<String>) -> Refusal {
    Refusal::new(ServerCode::AiRefused, detail)
}

/// The provider's own message, read from its answer: OpenAI's
/// `{"error": {"message": …}}`, Ollama's `{"error": "…"}`, or the text itself.
fn message(status: reqwest::StatusCode, text: &str) -> String {
    let said = serde_json::from_str::<Value>(text).ok().and_then(|v| {
        let error = v.get("error")?;
        error
            .get("message")
            .and_then(Value::as_str)
            .or_else(|| error.as_str())
            .map(str::to_owned)
    });
    let said = said.unwrap_or_else(|| text.trim().chars().take(300).collect());
    if said.is_empty() {
        format!("the provider answered {status}")
    } else {
        format!("the provider answered {status}: {said}")
    }
}

/// Send `body` to `upstream`'s chat completions and wait, at most `idle`, for
/// its answer to begin. A failure of the provider's becomes `ai/refused`.
async fn send(
    upstream: &Upstream,
    body: &Value,
    idle: Duration,
) -> Result<reqwest::Response, Refusal> {
    let mut call = HTTP
        .post(format!("{}/chat/completions", upstream.base_url))
        .json(body);
    if let Some(key) = &upstream.key {
        call = call.bearer_auth(key.expose_secret());
    }
    let response = tokio::time::timeout(idle, call.send())
        .await
        .map_err(|_| {
            silent(
                "the AI provider did not begin its answer within its deadline",
                idle,
            )
        })?
        .map_err(|e| {
            warn!("AI provider unreachable: {e}");
            Refusal::new(
                ServerCode::AiUnreachable,
                "the AI provider could not be reached",
            )
        })?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let text = tokio::time::timeout(idle, response.text())
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    warn!(%status, "AI provider refused");
    Err(refused(message(status, &text)))
}

/// `problem` as the chat completions stream's error event, the chunk an
/// OpenAI-compatible client reads as a failure rather than as more answer,
/// with the problem's own fields beside `message`. It opens with a blank line,
/// so a chunk the provider left half-written cannot swallow it.
///
/// The 200 and its headers are already sent when a stream goes quiet, so a
/// status cannot say it; cutting the connection would leave the browser a
/// network error and nothing to name.
fn error_event(problem: &Problem) -> Bytes {
    let mut error = serde_json::to_value(problem).expect("a Problem serializes");
    error["message"] = json!(problem.detail);
    Bytes::from(format!("\n\ndata: {}\n\n", json!({ "error": error })))
}

/// `chunks`, ended once `idle` passes without one: with `silence` as the last
/// chunk when there is one, or else with an I/O error.
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
                    "AI provider went silent mid-answer"
                );
                let last = silence.ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "the AI provider sent nothing within its deadline",
                    )
                });
                Some((last, None))
            }
        }
    })
}

/// Send `body` to `upstream` and stream its answer back, every wait bounded by `idle`.
async fn relay(upstream: &Upstream, body: &Value, idle: Duration) -> Result<Response, Refusal> {
    let response = send(upstream, body, idle).await?;
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or(header::HeaderValue::from_static("application/json"));
    // Only an answer that streams has a place to say it went quiet; a JSON body is cut.
    let silence = content_type
        .as_bytes()
        .starts_with(b"text/event-stream")
        .then(|| {
            error_event(
                &Refusal::silent(
                    ServerCode::AiSilent,
                    "the AI provider went silent mid-answer",
                    idle,
                )
                .body,
            )
        });
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(until_idle(
            response.bytes_stream(),
            idle,
            silence,
        )))
        .map_err(|e| {
            warn!("relayed answer not built: {e}");
            Refusal::internal()
        })
}

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(chat_completions))
        .routes(routes!(test_ai_model))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, StatusCode};
    use axum::response::IntoResponse;
    use std::sync::{Arc, Mutex};

    const SHORT: Duration = Duration::from_millis(300);

    /// The last call a fake provider saw: its path, `Authorization` and body.
    type Seen = Arc<Mutex<Option<(String, Option<String>, Value)>>>;

    fn upstream(url: String) -> Upstream {
        Upstream {
            base_url: url,
            model: "the-model".into(),
            key: Some(SecretString::from("sk-test")),
        }
    }

    async fn serve(app: axum::Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        url
    }

    async fn problem(refused: Refusal) -> (StatusCode, Value) {
        let response = refused.into_response();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[test]
    fn the_page_cannot_choose_the_model_raise_the_cap_or_say_who_asks() {
        let request: ChatCompletionRequest = serde_json::from_value(json!({
            "model": "gpt-4-the-expensive-one",
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 100000,
            "max_completion_tokens": 10,
            "user": "someone-else",
            "stream": true,
            "temperature": 0.2,
        }))
        .unwrap();
        let body = request.body("gpt-4o-mini").unwrap();
        assert_eq!(body["model"], "gpt-4o-mini");
        assert_eq!(body["max_tokens"], CAP);
        assert_eq!(body["max_completion_tokens"], 10);
        assert!(body.get("user").is_none());
        assert_eq!(body["stream"], true, "the rest goes untouched");
        assert_eq!(body["temperature"], 0.2);

        let bare: ChatCompletionRequest =
            serde_json::from_value(json!({ "messages": [] })).unwrap();
        let body = bare.body("m").unwrap();
        assert!(
            body.get("max_tokens").is_none() && body.get("max_completion_tokens").is_none(),
            "no limit is added: providers take one field or the other"
        );
    }

    #[tokio::test]
    async fn the_call_goes_to_the_roots_chat_completions_with_the_key() {
        let seen: Seen = Default::default();
        let keep = seen.clone();
        let url = serve(axum::Router::new().fallback(
            move |uri: axum::http::Uri, headers: HeaderMap, Json(body): Json<Value>| async move {
                let auth = headers
                    .get(header::AUTHORIZATION)
                    .map(|v| v.to_str().unwrap().to_owned());
                *keep.lock().unwrap() = Some((uri.path().to_owned(), auth, body));
                Json(json!({ "choices": [{ "message": { "content": "OK" } }] }))
            },
        ))
        .await;
        let response = relay(
            &upstream(url.clone()),
            &json!({ "model": "the-model" }),
            SHORT,
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let (path, auth, body) = seen.lock().unwrap().take().unwrap();
        assert_eq!(path, "/v1/chat/completions");
        assert_eq!(auth.as_deref(), Some("Bearer sk-test"));
        assert_eq!(body["model"], "the-model");

        let keyless = Upstream {
            key: None,
            ..upstream(url)
        };
        probe(&keyless, SHORT).await.unwrap();
        let (_, auth, _) = seen.lock().unwrap().take().unwrap();
        assert_eq!(auth, None, "no key, no Authorization: a local Ollama");
    }

    #[tokio::test]
    async fn a_providers_401_is_ai_refused_with_its_message_never_the_callers_401() {
        let url = serve(axum::Router::new().fallback(|| async {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": { "message": "Incorrect API key provided" } })),
            )
        }))
        .await;
        let (status, body) =
            problem(relay(&upstream(url), &json!({}), SHORT).await.unwrap_err()).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body["code"], "ai/refused");
        let detail = body["detail"].as_str().unwrap();
        assert!(
            detail.contains("401") && detail.contains("Incorrect API key"),
            "{detail}"
        );
    }

    #[tokio::test]
    async fn ollamas_error_string_is_read_too() {
        let url = serve(axum::Router::new().fallback(|| async {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "model \"llama9\" not found" })),
            )
        }))
        .await;
        let (_, body) = problem(probe(&upstream(url), SHORT).await.unwrap_err()).await;
        assert!(
            body["detail"].as_str().unwrap().contains("llama9"),
            "{body}"
        );
    }

    #[tokio::test]
    async fn an_answer_that_is_not_a_chat_completion_fails_the_test() {
        let url =
            serve(axum::Router::new().fallback(|| async { Json(json!({ "hello": 1 })) })).await;
        let (_, body) = problem(probe(&upstream(url), SHORT).await.unwrap_err()).await;
        assert_eq!(body["code"], "ai/refused");
    }

    #[tokio::test]
    async fn a_provider_that_accepts_and_never_answers_is_ai_silent() {
        let held = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", held.local_addr().unwrap());
        let started = Instant::now();
        let (status, body) =
            problem(relay(&upstream(url), &json!({}), SHORT).await.unwrap_err()).await;
        assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(body["code"], "ai/silent");
        assert_eq!(body["data"]["after"], 300);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    /// A provider that answers `content_type` with one chunk, then nothing.
    async fn quiet_after_one_chunk(content_type: &'static str) -> String {
        serve(axum::Router::new().fallback(move || async move {
            let first = futures::stream::iter([Ok::<_, std::io::Error>(Bytes::from_static(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n",
            ))]);
            Response::builder()
                .header(header::CONTENT_TYPE, content_type)
                .body(Body::from_stream(first.chain(futures::stream::pending())))
                .unwrap()
        }))
        .await
    }

    #[tokio::test]
    async fn a_provider_that_goes_quiet_mid_answer_ends_the_stream_with_ai_silent() {
        let url = quiet_after_one_chunk("text/event-stream").await;
        let response = relay(&upstream(url), &json!({}), SHORT).await.unwrap();
        let mut body = response.into_body().into_data_stream();
        assert!(
            body.next().await.unwrap().is_ok(),
            "what came before the silence is relayed"
        );
        let last = body
            .next()
            .await
            .unwrap()
            .expect("the silence is an event, not a cut");
        assert!(body.next().await.is_none(), "the event ends the stream");

        let text = std::str::from_utf8(&last).unwrap();
        assert!(
            text.starts_with("\n\ndata: ") && text.ends_with("\n\n"),
            "{text:?}"
        );
        let event: Value =
            serde_json::from_str(text.trim().strip_prefix("data: ").unwrap()).unwrap();
        // What an OpenAI-compatible client requires of an error chunk: an
        // `error` with a `message`, and no `choices`.
        assert!(event.get("choices").is_none());
        assert_eq!(event["error"]["message"], event["error"]["detail"]);
        assert_eq!(event["error"]["code"], "ai/silent");
        assert_eq!(event["error"]["data"]["after"], 300);
    }

    #[tokio::test]
    async fn a_json_answer_that_goes_quiet_is_cut() {
        let url = quiet_after_one_chunk("application/json").await;
        let response = relay(&upstream(url), &json!({}), SHORT).await.unwrap();
        let mut body = response.into_body().into_data_stream();
        assert!(body.next().await.unwrap().is_ok());
        assert!(body.next().await.unwrap().is_err());
    }

    #[tokio::test]
    async fn an_unreachable_provider_is_ai_unreachable() {
        let (status, body) = problem(
            relay(&upstream("http://127.0.0.1:1".into()), &json!({}), SHORT)
                .await
                .unwrap_err(),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body["code"], "ai/unreachable");
    }
}
