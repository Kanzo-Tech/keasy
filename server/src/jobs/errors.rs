use serde::{Deserialize, Serialize};

/// Runtime job error — stored in the database as JSON on a failed job.
/// This is NOT an API error type; it is a serializable record of what went wrong during execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRuntimeError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl JobRuntimeError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), detail: None }
    }

    pub fn with_detail(code: &str, message: impl Into<String>, detail: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), detail: Some(detail.into()) }
    }
}

pub fn classify_error(raw: &str) -> JobRuntimeError {
    let lower = raw.to_lowercase();

    if lower.contains("account must be specified")
        || lower.contains("missing credentials")
        || lower.contains("no credentials")
    {
        return JobRuntimeError::with_detail(
            "CLOUD_CREDENTIALS_MISSING",
            "Cloud storage credentials are missing. Configure them in Settings → Cloud Accounts.",
            raw,
        );
    }

    if lower.contains("access denied")
        || lower.contains("forbidden")
        || lower.contains("authorization")
        || lower.contains("not authorized")
    {
        return JobRuntimeError::with_detail(
            "CLOUD_ACCESS_DENIED",
            "Access denied to cloud storage. Check your account permissions.",
            raw,
        );
    }

    if lower.contains("region") && (lower.contains("must") || lower.contains("required")) {
        return JobRuntimeError::with_detail(
            "CLOUD_REGION_MISSING",
            "Cloud storage region is not configured.",
            raw,
        );
    }

    if lower.contains("not found") && (lower.contains("bucket") || lower.contains("container")) {
        return JobRuntimeError::with_detail(
            "CLOUD_NOT_FOUND",
            "The specified bucket or container was not found.",
            raw,
        );
    }

    if lower.contains("connection refused")
        || lower.contains("dns")
        || lower.contains("timeout")
        || lower.contains("connect error")
    {
        return JobRuntimeError::with_detail(
            "CLOUD_CONNECTION_FAILED",
            "Failed to connect to cloud storage.",
            raw,
        );
    }

    JobRuntimeError::new("EXECUTION_ERROR", raw)
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
    #[error("script rewrite failed: {0}")]
    RewriteFailed(String),
    #[error("no catalog available for this job")]
    NoCatalog,
    #[error("serialization failed: {0}")]
    Serialization(String),
}

impl JobApiError {
    pub fn to_http(&self) -> (axum::http::StatusCode, &'static str, String) {
        match self {
            JobApiError::NotFound => (
                axum::http::StatusCode::NOT_FOUND,
                "not_found",
                "Job not found".to_string(),
            ),
            JobApiError::NotDraft => (
                axum::http::StatusCode::BAD_REQUEST,
                "not_draft",
                "Only draft jobs can be updated".to_string(),
            ),
            JobApiError::InvalidFormat(msg) => (
                axum::http::StatusCode::BAD_REQUEST,
                "invalid_format",
                msg.clone(),
            ),
            JobApiError::RewriteFailed(msg) => (
                axum::http::StatusCode::BAD_REQUEST,
                "rewrite_error",
                msg.clone(),
            ),
            JobApiError::NoCatalog => (
                axum::http::StatusCode::NOT_FOUND,
                "no_catalog",
                "No DCAT catalog available for this job".to_string(),
            ),
            JobApiError::Serialization(msg) => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "serialization_error",
                msg.clone(),
            ),
        }
    }
}

impl axum::response::IntoResponse for JobApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, code, message) = self.to_http();
        (status, axum::Json(crate::error::error_body(code, &message))).into_response()
    }
}
