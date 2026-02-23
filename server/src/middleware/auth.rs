use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use secrecy::ExposeSecret;
use subtle::ConstantTimeEq;

use crate::AppState;
use crate::routes::error_response;

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
        _ => error_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid or missing API key",
        ),
    }
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

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
