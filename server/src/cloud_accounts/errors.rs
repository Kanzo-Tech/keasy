#[derive(Debug, thiserror::Error)]
pub enum CloudAccountError {
    #[error("cloud account not found")]
    NotFound,
    #[error("validation failed: {0}")]
    ValidationFailed(String),
}

impl CloudAccountError {
    pub fn to_http(&self) -> (axum::http::StatusCode, &'static str, String) {
        match self {
            CloudAccountError::NotFound => (
                axum::http::StatusCode::NOT_FOUND,
                "not_found",
                "Cloud account not found".to_string(),
            ),
            CloudAccountError::ValidationFailed(msg) => (
                axum::http::StatusCode::BAD_REQUEST,
                "validation_failed",
                msg.clone(),
            ),
        }
    }
}

impl axum::response::IntoResponse for CloudAccountError {
    fn into_response(self) -> axum::response::Response {
        let (status, code, message) = self.to_http();
        (status, axum::Json(crate::error::error_body(code, &message))).into_response()
    }
}
