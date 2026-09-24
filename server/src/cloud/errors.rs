use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::db::DbError;

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
            CloudAccountError::NotFound => (
                StatusCode::NOT_FOUND,
                axum::Json(crate::error::error_body(
                    "not_found",
                    "Cloud account not found",
                )),
            )
                .into_response(),
            CloudAccountError::Db(e) => e.into_response(),
        }
    }
}
