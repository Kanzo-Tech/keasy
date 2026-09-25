use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use keasy_api::{ErrorBody, ErrorCode};

/// The one way the server refuses: a status and an [`ErrorBody`].
pub fn fail(status: StatusCode, error: ErrorCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(ErrorBody {
            error,
            message: message.into(),
        }),
    )
        .into_response()
}
