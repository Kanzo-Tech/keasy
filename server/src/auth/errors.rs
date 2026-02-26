use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use crate::error::error_body;

#[allow(dead_code)]
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("auth/invalid_credentials")]
    InvalidCredentials,

    #[error("auth/registration_failed")]
    RegistrationFailed,

    #[error("auth/session_required")]
    SessionRequired,

    #[error("auth/session_expired")]
    SessionExpired,

    #[error("auth/rate_limited")]
    RateLimited,

    #[error("auth/forbidden")]
    Forbidden,

    #[error("auth/validation_failed")]
    ValidationFailed(String),

    #[error("internal")]
    Internal(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        match self {
            AuthError::InvalidCredentials => (
                StatusCode::UNAUTHORIZED,
                Json(error_body("auth/invalid_credentials", "Invalid email or password")),
            ).into_response(),

            AuthError::RegistrationFailed => (
                StatusCode::BAD_REQUEST,
                Json(error_body("auth/registration_failed", "Registration failed")),
            ).into_response(),

            AuthError::SessionRequired => (
                StatusCode::UNAUTHORIZED,
                Json(error_body("auth/session_required", "Authentication required")),
            ).into_response(),

            // Session expired: 401 + Location header hint per CONTEXT.md
            AuthError::SessionExpired => (
                StatusCode::UNAUTHORIZED,
                [(axum::http::header::LOCATION, "/login")],
                Json(error_body("auth/session_expired", "Session expired")),
            ).into_response(),

            AuthError::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                Json(error_body("auth/rate_limited", "Too many requests, please try again later")),
            ).into_response(),

            AuthError::Forbidden => (
                StatusCode::FORBIDDEN,
                Json(error_body("auth/forbidden", "Access denied")),
            ).into_response(),

            AuthError::ValidationFailed(_detail) => (
                StatusCode::BAD_REQUEST,
                Json(error_body("auth/validation_failed", "Validation failed")),
            ).into_response(),

            AuthError::Internal(detail) => {
                tracing::error!(detail = %detail, "Auth internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(error_body("internal_error", "An internal error occurred")),
                ).into_response()
            }
        }
    }
}
