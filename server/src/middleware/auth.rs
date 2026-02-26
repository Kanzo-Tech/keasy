use axum::{
    Json,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use secrecy::ExposeSecret;
use subtle::ConstantTimeEq;

use crate::AppState;
use crate::error::error_body;

#[allow(dead_code)]
pub async fn api_key_auth(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let provided_key = extract_key(request.headers());

    match provided_key {
        Some(key) if constant_time_eq(key, state.api_key.expose_secret()) => {
            next.run(request).await
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(error_body("unauthorized", "Invalid or missing API key")),
        )
            .into_response(),
    }
}

#[allow(dead_code)]
fn constant_time_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

#[allow(dead_code)]
fn extract_key(headers: &axum::http::HeaderMap) -> Option<&str> {
    if let Some(val) = headers.get("x-api-key") {
        return val.to_str().ok();
    }

    if let Some(val) = headers.get("authorization")
        && let Ok(s) = val.to_str()
    {
        return s.strip_prefix("Bearer ");
    }

    None
}
