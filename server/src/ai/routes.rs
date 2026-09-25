use axum::Json;
use axum::extract::State;
use axum::response::sse::{KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use strum::VariantArray;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::warn;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::client::{AiUnavailable, require_ai_settings, stream};
use keasy_api::ErrorBody;
use keasy_api::ai::{AiProviderInfo, CompletionRequest};
use keasy_api::settings::ai::AiProvider;

use crate::AppState;
use crate::auth::role::Member;

#[utoipa::path(get, path = "/v1/ai/providers", tag = "AI",
    responses((status = 200, description = "Every provider keasy can call, with its default model", body = Vec<AiProviderInfo>))
)]
/// The providers a call can run on, and the model each runs when its settings
/// name none. Whether one is configured is `/v1/settings/ai/providers`.
pub async fn list_providers(_: Member) -> Json<Vec<AiProviderInfo>> {
    Json(
        AiProvider::VARIANTS
            .iter()
            .map(|&provider| AiProviderInfo {
                provider,
                default_model: provider.default_model(),
            })
            .collect(),
    )
}

#[utoipa::path(post, path = "/v1/ai/stream", tag = "AI",
    request_body = CompletionRequest,
    responses(
        (status = 200, description = "SSE stream: `delta` frames carry text; an `error` frame carries an ErrorBody; the stream ends when the model does", content_type = "text/event-stream"),
        (status = 400, description = "No AI provider configured", body = ErrorBody),
    )
)]
/// The one model call: the browser sends the prompt, the server adds the key
/// and relays the answer as it streams.
pub async fn complete_stream(
    _: Member,
    State(state): State<AppState>,
    Json(req): Json<CompletionRequest>,
) -> Result<Response, AiUnavailable> {
    let settings = require_ai_settings(state.db.ai_provider(req.provider).await)?;
    let (tx, rx) = mpsc::channel(32);
    tokio::spawn(async move {
        let call = stream(&settings, &req.system, &req.messages, req.max_tokens, &tx);
        // A reader who leaves drops the call, and with it the upstream request.
        let result = tokio::select! {
            () = tx.closed() => return,
            out = call => out,
        };
        if let Err(e) = result {
            warn!("LLM stream failed: {e}");
            let _ = tx.send(Ok(e.event())).await;
        }
    });
    Ok(Sse::new(ReceiverStream::new(rx))
        .keep_alive(KeepAlive::default())
        .into_response())
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_providers))
        .routes(routes!(complete_stream))
}
