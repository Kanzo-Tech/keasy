use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use crate::error::error_body;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("auth/session_required")]
    SessionRequired,

    #[error("auth/session_expired")]
    SessionExpired,

    #[error("auth/forbidden")]
    Forbidden,

    #[error("auth/validation_failed")]
    ValidationFailed(String),

    #[error("auth/vc_unavailable")]
    VcUnavailable,

    #[error("internal")]
    Internal(String),

    // ── OIDC errors ──────────────────────────────────────────────────────────

    #[error("auth/oidc_not_configured")]
    OidcNotConfigured,

    #[error("auth/oidc_state_mismatch")]
    OidcStateMismatch,

    #[error("auth/oidc_token_exchange")]
    OidcTokenExchange,

    #[error("auth/oidc_no_id_token")]
    OidcNoIdToken,

    #[error("auth/oidc_token_invalid")]
    OidcTokenInvalid,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        match self {
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

            AuthError::Forbidden => (
                StatusCode::FORBIDDEN,
                Json(error_body("auth/forbidden", "Access denied")),
            ).into_response(),

            AuthError::VcUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(error_body("auth/vc_unavailable", "VC login temporarily unavailable")),
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

            // OIDC errors — browser-facing, so redirect (not JSON) where appropriate.

            AuthError::OidcNotConfigured => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("auth/oidc_not_configured", "OIDC authentication is not configured")),
            ).into_response(),

            // The following OIDC errors occur during browser redirects — return a
            // 302 redirect to /login?error=auth_failed so the user sees an error banner.
            AuthError::OidcStateMismatch => {
                Redirect::to("/login?error=auth_failed").into_response()
            }

            AuthError::OidcTokenExchange => {
                Redirect::to("/login?error=auth_failed").into_response()
            }

            AuthError::OidcNoIdToken => {
                Redirect::to("/login?error=auth_failed").into_response()
            }

            AuthError::OidcTokenInvalid => {
                Redirect::to("/login?error=auth_failed").into_response()
            }
        }
    }
}
