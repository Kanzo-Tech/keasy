use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::error::error_body;

#[derive(Debug, thiserror::Error)]
pub enum ConnectorError {
    #[error("connector not found")]
    NotFound,

    #[error("validation failed: {0}")]
    ValidationFailed(String),

    #[error("unknown connector type: {0}")]
    UnknownType(String),

    #[error("storage error: {0}")]
    Storage(#[from] object_store::Error),

    #[error("connection test failed: {0}")]
    TestFailed(String),

    #[error("{0}")]
    Internal(String),
}

impl IntoResponse for ConnectorError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            ConnectorError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            ConnectorError::ValidationFailed(_) => {
                (StatusCode::BAD_REQUEST, "validation_failed")
            }
            ConnectorError::UnknownType(_) => (StatusCode::BAD_REQUEST, "unknown_type"),
            ConnectorError::Storage(_) => (StatusCode::BAD_GATEWAY, "storage_error"),
            ConnectorError::TestFailed(_) => (StatusCode::BAD_REQUEST, "test_failed"),
            ConnectorError::Internal(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
        };
        (status, Json(error_body(code, self.to_string()))).into_response()
    }
}
