use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use keasy_api::{ErrorBody, ErrorCode};

/// The one way the server refuses: a status and an [`ErrorBody`].
pub fn fail(status: StatusCode, error: ErrorCode, message: impl Into<String>) -> Response {
    fail_about(status, error, message, Vec::new())
}

/// Why a credential, connection or model call was refused.
#[derive(Debug)]
pub enum Refusal {
    Status {
        status: StatusCode,
        error: ErrorCode,
        message: String,
        dependents: Vec<String>,
    },
    Db(crate::db::DbError),
}

impl Refusal {
    pub fn new(status: StatusCode, error: ErrorCode, message: impl Into<String>) -> Self {
        Self::Status {
            status,
            error,
            message: message.into(),
            dependents: Vec::new(),
        }
    }

    pub fn not_found(what: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            ErrorCode::NotFound,
            format!("{what} not found"),
        )
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, ErrorCode::Forbidden, message)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::ValidationFailed,
            message,
        )
    }

    /// A probe failed: the store or provider did not accept what it was shown.
    pub fn probe_failed(message: impl Into<String>, dependents: Vec<String>) -> Self {
        Self::Status {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            error: ErrorCode::ProbeFailed,
            message: message.into(),
            dependents,
        }
    }
}

impl From<crate::db::DbError> for Refusal {
    fn from(e: crate::db::DbError) -> Self {
        Self::Db(e)
    }
}

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        match self {
            Self::Status {
                status,
                error,
                message,
                dependents,
            } => fail_about(status, error, message, dependents),
            Self::Db(e) => e.into_response(),
        }
    }
}

/// A refusal that names the resources it is about.
pub fn fail_about(
    status: StatusCode,
    error: ErrorCode,
    message: impl Into<String>,
    dependents: Vec<String>,
) -> Response {
    (
        status,
        Json(ErrorBody {
            error,
            message: message.into(),
            dependents,
        }),
    )
        .into_response()
}
