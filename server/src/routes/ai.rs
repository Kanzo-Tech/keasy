use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::{KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::warn;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::ai::CompletionRequest;
use crate::api::connections::ConnectionView;
use crate::api::credentials::Purpose;
use crate::api::{ErrorBody, ErrorCode};
use crate::llm_client::stream;

use crate::authentication::role::Member;
use crate::error::Refusal;
use crate::startup::AppState;

/// The model connection a call runs on: the one it names, or the only one.
async fn model_connection(state: &AppState, name: Option<&str>) -> Result<ConnectionView, Refusal> {
    if let Some(name) = name {
        return crate::connections::named(&state.db, name).await;
    }
    let mut models =
        crate::connections::persistence::list(&*state.db.read().await, Some(Purpose::Model))?;
    match models.len() {
        1 => Ok(models.remove(0)),
        0 => Err(Refusal::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::AiNotConfigured,
            "No model connection exists. Add a model credential and a connection on it.",
        )),
        _ => Err(Refusal::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::AiConnectionRequired,
            "Several model connections exist: name the one to call.",
        )),
    }
}

#[utoipa::path(post, path = "/v1/ai/stream", tag = "AI",
    request_body = CompletionRequest,
    responses(
        (status = 200, description = "SSE stream: `delta` frames carry text; an `error` frame carries an ErrorBody; the stream ends when the model does", content_type = "text/event-stream"),
        (status = 400, description = "No model connection, or several and none named", body = ErrorBody),
        (status = 404, description = "No such connection", body = ErrorBody),
    )
)]
/// The one model call: the browser sends the prompt, the server adds the key
/// of the model connection and relays the answer as it streams.
pub async fn complete_stream(
    _: Member,
    State(state): State<AppState>,
    Json(req): Json<CompletionRequest>,
) -> Result<Response, Refusal> {
    let connection = model_connection(&state, req.connection.as_deref()).await?;
    let (target, credential) = crate::connections::model(&state.db, &connection).await?;
    let (tx, rx) = mpsc::channel(32);
    tokio::spawn(async move {
        let call = stream(
            &credential,
            &target,
            &req.system,
            &req.messages,
            req.max_tokens,
            &tx,
        );
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
    OpenApiRouter::new().routes(routes!(complete_stream))
}
