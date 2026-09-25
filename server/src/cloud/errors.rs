use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use keasy_api::ErrorCode;

use crate::db::DbError;
use crate::error::fail;

#[derive(Debug, thiserror::Error)]
pub enum CloudAccountError {
    #[error("cloud account not found")]
    NotFound,
    #[error(transparent)]
    Db(#[from] DbError),
}

impl IntoResponse for CloudAccountError {
    fn into_response(self) -> Response {
        match self {
            CloudAccountError::NotFound => fail(
                StatusCode::NOT_FOUND,
                ErrorCode::NotFound,
                "Cloud account not found",
            ),
            CloudAccountError::Db(e) => e.into_response(),
        }
    }
}
