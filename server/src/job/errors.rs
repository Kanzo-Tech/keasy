use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl JobError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), detail: None }
    }

    pub fn with_detail(code: &str, message: impl Into<String>, detail: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), detail: Some(detail.into()) }
    }
}

pub fn classify_error(raw: &str) -> JobError {
    let lower = raw.to_lowercase();

    if lower.contains("account must be specified")
        || lower.contains("missing credentials")
        || lower.contains("no credentials")
    {
        return JobError::with_detail(
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
        return JobError::with_detail(
            "CLOUD_ACCESS_DENIED",
            "Access denied to cloud storage. Check your account permissions.",
            raw,
        );
    }

    if lower.contains("region") && (lower.contains("must") || lower.contains("required")) {
        return JobError::with_detail(
            "CLOUD_REGION_MISSING",
            "Cloud storage region is not configured.",
            raw,
        );
    }

    if lower.contains("not found") && (lower.contains("bucket") || lower.contains("container")) {
        return JobError::with_detail(
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
        return JobError::with_detail(
            "CLOUD_CONNECTION_FAILED",
            "Failed to connect to cloud storage.",
            raw,
        );
    }

    JobError::new("EXECUTION_ERROR", raw)
}
