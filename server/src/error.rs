use axum::Json;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::{Value, json};

/// Build a flat error body: `{ "error": "snake_case_code", "message": "..." }`.
/// This is the locked response format for all error responses.
pub fn error_body(code: &str, message: impl Into<String>) -> Value {
    json!({ "error": code, "message": message.into() })
}

/// Typed envelope for successful API responses: `{ "data": T }`.
#[derive(Serialize, utoipa::ToSchema)]
pub struct DataResponse<T: Serialize> {
    pub data: T,
}

impl<T: Serialize> IntoResponse for DataResponse<T> {
    fn into_response(self) -> Response {
        Json(self).into_response()
    }
}

/// Wrap a successful payload in the standard response envelope: `{ "data": value }`.
/// All successful responses except 204 No Content use this helper.
pub fn data_response<T: Serialize>(value: T) -> DataResponse<T> {
    DataResponse { data: value }
}
