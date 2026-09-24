use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::db::DbError;

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
    #[error(transparent)]
    Db(DbError),
}

impl From<DbError> for ConnectionError {
    fn from(e: DbError) -> Self {
        match e {
            DbError::Invalid(message) => ConnectionError::InvalidConnection(message),
            e => ConnectionError::Db(e),
        }
    }
}

impl IntoResponse for ConnectionError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            ConnectionError::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found",
                "Connection not found".to_string(),
            ),
            ConnectionError::ContainerNotFound(msg) => {
                (StatusCode::BAD_REQUEST, "container_not_found", msg)
            }
            ConnectionError::InvalidConnection(msg) => {
                (StatusCode::BAD_REQUEST, "invalid_connection", msg)
            }
            ConnectionError::Forbidden(msg) => (StatusCode::FORBIDDEN, "forbidden", msg),
            ConnectionError::ListFilesFailed(msg) => {
                (StatusCode::BAD_GATEWAY, "list_files_failed", msg)
            }
            ConnectionError::Db(e) => return e.into_response(),
        };
        (status, axum::Json(crate::error::error_body(code, message))).into_response()
    }
}
