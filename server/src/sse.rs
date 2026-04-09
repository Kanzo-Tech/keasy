use std::convert::Infallible;

use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

/// Convert an SSE channel receiver into an Axum SSE response.
pub fn into_sse_response(sse_rx: mpsc::Receiver<Result<Event, Infallible>>) -> Response {
    Sse::new(ReceiverStream::new(sse_rx))
        .keep_alive(KeepAlive::default())
        .into_response()
}
