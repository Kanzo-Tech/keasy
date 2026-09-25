use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use keasy_api::ErrorCode;

use crate::db::DbError;
use crate::error::fail;

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
    #[error("failed to sign: {0}")]
    SignFailed(String),
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
        match self {
            ConnectionError::NotFound => fail(
                StatusCode::NOT_FOUND,
                ErrorCode::NotFound,
                "Connection not found",
            ),
            ConnectionError::ContainerNotFound(msg) => {
                fail(StatusCode::BAD_REQUEST, ErrorCode::ContainerNotFound, msg)
            }
            ConnectionError::InvalidConnection(msg) => {
                fail(StatusCode::BAD_REQUEST, ErrorCode::InvalidConnection, msg)
            }
            ConnectionError::Forbidden(msg) => {
                fail(StatusCode::FORBIDDEN, ErrorCode::Forbidden, msg)
            }
            ConnectionError::ListFilesFailed(msg) => {
                fail(StatusCode::BAD_GATEWAY, ErrorCode::ListFilesFailed, msg)
            }
            ConnectionError::SignFailed(msg) => {
                fail(StatusCode::INTERNAL_SERVER_ERROR, ErrorCode::SignError, msg)
            }
            ConnectionError::Db(e) => e.into_response(),
        }
    }
}
