use std::collections::HashMap;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::{Value, json};

/// Build a flat error body: `{ "error": "snake_case_code", "message": "..." }`.
/// This is the locked response format for all error responses.
pub fn error_body(code: &str, message: impl Into<String>) -> Value {
    json!({ "error": code, "message": message.into() })
}

/// Build a validation error body with per-field reasons:
/// `{ "error": "validation_failed", "message": "...", "fields": { "field": "reason" } }`.
pub fn validation_error_body(message: impl Into<String>, fields: &HashMap<String, String>) -> Value {
    json!({ "error": "validation_failed", "message": message.into(), "fields": fields })
}

/// Wrap a successful payload in the standard response envelope: `{ "data": value }`.
/// All successful responses except 204 No Content use this helper.
pub fn data_response<T: Serialize>(value: T) -> Json<Value> {
    Json(json!({ "data": value }))
}

/// Typed application error enum.
/// `impl IntoResponse` maps each variant to the correct HTTP status and error body.
/// Variants not yet used directly — Phase 4 auth middleware will construct these.
#[allow(dead_code)]
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// 404 Not Found
    #[error("not_found")]
    NotFound,

    /// 400 Bad Request
    #[error("bad_request: {0}")]
    BadRequest(String),

    /// 400 Bad Request — validation failure with per-field details
    #[error("validation_failed: {message}")]
    ValidationFailed {
        message: String,
        fields: HashMap<String, String>,
    },

    /// 502 Bad Gateway — upstream cloud error
    #[error("cloud_error: {0}")]
    CloudError(String),

    /// 500 Internal Server Error.
    /// The inner string is logged via `tracing::error!` but NOT returned to the caller.
    #[error("internal: {0}")]
    Internal(String),

    /// Bridging variants for domain errors
    #[error(transparent)]
    JobApi(#[from] crate::jobs::errors::JobApiError),
    #[error(transparent)]
    Connection(#[from] crate::connections::errors::ConnectionError),
    #[error(transparent)]
    CloudAccount(#[from] crate::cloud::errors::CloudAccountError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::NotFound => (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "Resource not found")),
            )
                .into_response(),

            AppError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                Json(error_body("bad_request", msg)),
            )
                .into_response(),

            AppError::ValidationFailed { message, ref fields } => (
                StatusCode::BAD_REQUEST,
                Json(validation_error_body(&message, fields)),
            )
                .into_response(),

            AppError::CloudError(msg) => (
                StatusCode::BAD_GATEWAY,
                Json(error_body("cloud_error", msg)),
            )
                .into_response(),

            AppError::Internal(detail) => {
                tracing::error!(detail = %detail, "Internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_body("internal_error", "An internal error occurred")),
                )
                    .into_response()
            }

            AppError::JobApi(e) => e.into_response(),
            AppError::Connection(e) => e.into_response(),
            AppError::CloudAccount(e) => e.into_response(),
        }
    }
}
