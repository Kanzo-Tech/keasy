use keasy_api::ErrorCode;
use keasy_api::jobs::JobRuntimeError;

use crate::error::fail;

pub(crate) fn runtime_error(
    code: &str,
    message: impl Into<String>,
    detail: Option<&str>,
) -> JobRuntimeError {
    JobRuntimeError {
        code: code.into(),
        message: message.into(),
        detail: detail.map(str::to_owned),
    }
}

pub fn classify_error(raw: &str) -> JobRuntimeError {
    let lower = raw.to_lowercase();

    if lower.contains("account must be specified")
        || lower.contains("missing credentials")
        || lower.contains("no credentials")
    {
        return runtime_error(
            "CLOUD_CREDENTIALS_MISSING",
            "Cloud storage credentials are missing. Configure them in Settings → Cloud Accounts.",
            Some(raw),
        );
    }

    if lower.contains("access denied")
        || lower.contains("forbidden")
        || lower.contains("authorization")
        || lower.contains("not authorized")
    {
        return runtime_error(
            "CLOUD_ACCESS_DENIED",
            "Access denied to cloud storage. Check your account permissions.",
            Some(raw),
        );
    }

    if lower.contains("region") && (lower.contains("must") || lower.contains("required")) {
        return runtime_error(
            "CLOUD_REGION_MISSING",
            "Cloud storage region is not configured.",
            Some(raw),
        );
    }

    if lower.contains("not found") && (lower.contains("bucket") || lower.contains("container")) {
        return runtime_error(
            "CLOUD_NOT_FOUND",
            "The specified bucket or container was not found.",
            Some(raw),
        );
    }

    if lower.contains("connection refused")
        || lower.contains("dns")
        || lower.contains("timeout")
        || lower.contains("connect error")
    {
        return runtime_error(
            "CLOUD_CONNECTION_FAILED",
            "Failed to connect to cloud storage.",
            Some(raw),
        );
    }

    runtime_error("EXECUTION_ERROR", raw, None)
}

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
                "sink_connection_id must name the workspace sink",
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
