//! Every model call, relayed to the platform's AI gateway. The browser speaks
//! OpenAI chat completions to this route as it would to the gateway itself;
//! what the server adds is what the browser must not hold or decide: the
//! workspace's key, who is asking, and how much an answer may cost.

use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::Response;
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
            // long as the model writes it.
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("a TLS backend is compiled in"),
        }
    }
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
        (status = 200, description = "The gateway's answer as it streams: OpenAI chat completion chunks (`text/event-stream`) or one completion (`application/json`)"),
        (status = 400, description = "Not an alias, or a malformed request", body = ErrorBody),
        (status = 502, description = "The AI gateway did not answer", body = ErrorBody),
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

    let upstream = gateway
        .http
        .post(format!("{}/v1/chat/completions", gateway.url))
        .bearer_auth(gateway.key.expose_secret())
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            warn!("AI gateway unreachable: {e}");
            Refusal::new(
                StatusCode::BAD_GATEWAY,
                ErrorCode::AiUnreachable,
                "the AI gateway did not answer",
            )
        })?;

    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or(header::HeaderValue::from_static("application/json"));
    Response::builder()
        .status(upstream.status())
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(upstream.bytes_stream()))
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
