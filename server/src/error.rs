use std::collections::HashMap;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
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

/// Typed envelope for successful API responses: `{ "data": T }`.
#[derive(Serialize, utoipa::ToSchema)]
pub struct DataResponse<T: Serialize> {
    pub data: T,
}

impl<T: Serialize> IntoResponse for DataResponse<T> {
    fn into_response(self) -> Response {
        Json(self).into_response()
    }
}

/// Wrap a successful payload in the standard response envelope: `{ "data": value }`.
/// All successful responses except 204 No Content use this helper.
pub fn data_response<T: Serialize>(value: T) -> DataResponse<T> {
    DataResponse { data: value }
}

/// Build a 500 response with a logged detail message and opaque user-facing body.
pub fn internal_error_response(msg: &str) -> Response {
    tracing::error!("{}", msg);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(error_body("internal_error", "An internal error occurred")),
    )
        .into_response()
}

/// Build a 400 response with a caller-visible message.
pub fn bad_request_response(msg: impl Into<String>) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(error_body("bad_request", msg)),
    )
        .into_response()
}

/// Unified application error type.
/// `impl IntoResponse` maps each variant to the correct HTTP status and error body.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,

    #[error("validation: {0}")]
    Validation(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("session expired")]
    SessionExpired,

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("bad gateway: {0}")]
    BadGateway(String),

    #[error("OIDC redirect")]
    OidcRedirect,

    #[error("OIDC not configured")]
    OidcNotConfigured,

    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::NotFound => (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "Resource not found")),
            )
                .into_response(),

            AppError::Validation(msg) => (
                StatusCode::BAD_REQUEST,
                Json(error_body("validation_failed", msg)),
            )
                .into_response(),

            AppError::Conflict(msg) => (
                StatusCode::CONFLICT,
                Json(error_body("conflict", msg)),
            )
                .into_response(),

            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                Json(error_body("auth/session_required", "Authentication required")),
            )
                .into_response(),

            AppError::SessionExpired => (
                StatusCode::UNAUTHORIZED,
                [(axum::http::header::LOCATION, "/v1/auth/oidc-start")],
                Json(error_body("auth/session_expired", "Session expired")),
            )
                .into_response(),

            AppError::Forbidden(msg) => (
                StatusCode::FORBIDDEN,
                Json(error_body("forbidden", msg)),
            )
                .into_response(),

            AppError::BadGateway(msg) => (
                StatusCode::BAD_GATEWAY,
                Json(error_body("bad_gateway", msg)),
            )
                .into_response(),

            AppError::OidcRedirect => {
                Redirect::to("/v1/auth/oidc-start").into_response()
            }

            AppError::OidcNotConfigured => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("auth/oidc_not_configured", "OIDC authentication is not configured")),
            )
                .into_response(),

            AppError::Internal(err) => {
                tracing::error!(detail = %err, "Internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_body("internal_error", "An internal error occurred")),
                )
                    .into_response()
            }
        }
    }
}
