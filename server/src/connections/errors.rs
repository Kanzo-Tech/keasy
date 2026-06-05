#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    #[error("connection not found")]
    NotFound,
    #[error("container not found: {0}")]
    ContainerNotFound(String),
    #[error("invalid connection: {0}")]
    InvalidConnection(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("failed to list files: {0}")]
    ListFilesFailed(String),
    #[error("schema inference failed: {0}")]
    SchemaInferenceFailed(String),
    #[error("upload failed: {0}")]
    UploadFailed(String),
    #[error("internal: {0}")]
    Internal(String),
}

impl ConnectionError {
    pub fn to_http(&self) -> (axum::http::StatusCode, &'static str, String) {
        match self {
            ConnectionError::NotFound => (
                axum::http::StatusCode::NOT_FOUND,
                "not_found",
                "Connection not found".to_string(),
            ),
            ConnectionError::ContainerNotFound(msg) => (
                axum::http::StatusCode::BAD_REQUEST,
                "container_not_found",
                msg.clone(),
            ),
            ConnectionError::InvalidConnection(msg) => (
                axum::http::StatusCode::BAD_REQUEST,
                "invalid_connection",
                msg.clone(),
            ),
            ConnectionError::Forbidden(msg) => (
                axum::http::StatusCode::FORBIDDEN,
                "forbidden",
                msg.clone(),
            ),
            ConnectionError::ListFilesFailed(msg) => (
                axum::http::StatusCode::BAD_GATEWAY,
                "list_files_failed",
                msg.clone(),
            ),
            ConnectionError::SchemaInferenceFailed(msg) => (
                axum::http::StatusCode::BAD_REQUEST,
                "schema_inference_failed",
                msg.clone(),
            ),
            ConnectionError::UploadFailed(msg) => (
                axum::http::StatusCode::BAD_GATEWAY,
                "upload_failed",
                msg.clone(),
            ),
            ConnectionError::Internal(msg) => {
                tracing::error!(detail = %msg, "Internal connection error");
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An internal error occurred".to_string(),
                )
            }
        }
    }
}

impl axum::response::IntoResponse for ConnectionError {
    fn into_response(self) -> axum::response::Response {
        let (status, code, message) = self.to_http();
        (status, axum::Json(crate::error::error_body(code, &message))).into_response()
    }
}
