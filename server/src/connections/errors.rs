#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    #[error("connection not found")]
    NotFound,
    #[error("container not found: {0}")]
    ContainerNotFound(String),
    #[error("invalid connection: {0}")]
    InvalidConnection(String),
    #[error("failed to list files: {0}")]
    ListFilesFailed(String),
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
            ConnectionError::ListFilesFailed(msg) => (
                axum::http::StatusCode::BAD_GATEWAY,
                "list_files_failed",
                msg.clone(),
            ),
        }
    }
}

impl axum::response::IntoResponse for ConnectionError {
    fn into_response(self) -> axum::response::Response {
        let (status, code, message) = self.to_http();
        (status, axum::Json(crate::error::error_body(code, &message))).into_response()
    }
}
