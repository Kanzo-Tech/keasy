use keasy_api::ErrorCode;

use crate::error::fail;

/// API-level error for job route handlers.
#[derive(Debug, thiserror::Error)]
pub enum JobApiError {
    #[error("job not found")]
    NotFound,
    #[error("only draft jobs can be updated")]
    NotDraft,
    #[error("invalid format: {0}")]
    InvalidFormat(String),
    #[error("the destination is not a sink")]
    InvalidDestination,
    #[error("cannot delete a running job")]
    StillRunning,
    #[error(transparent)]
    Db(#[from] crate::db::DbError),
}

impl axum::response::IntoResponse for JobApiError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        match self {
            JobApiError::NotFound => {
                fail(StatusCode::NOT_FOUND, ErrorCode::NotFound, "Job not found")
            }
            JobApiError::NotDraft => fail(
                StatusCode::BAD_REQUEST,
                ErrorCode::NotDraft,
                "Only draft jobs can be updated",
            ),
            JobApiError::InvalidFormat(msg) => {
                fail(StatusCode::BAD_REQUEST, ErrorCode::InvalidFormat, msg)
            }
            JobApiError::InvalidDestination => fail(
                StatusCode::BAD_REQUEST,
                ErrorCode::InvalidDestination,
                "sink_connection must name the workspace sink",
            ),
            JobApiError::StillRunning => fail(
                StatusCode::CONFLICT,
                ErrorCode::StillRunning,
                "Cannot delete a job that is still running",
            ),
            JobApiError::Db(e) => e.into_response(),
        }
    }
}
