use axum::body::Body;
use axum::middleware::Next;
use axum::response::Response;

use super::session_auth::AuthenticatedUser;

pub async fn audit_log(
    request: axum::http::Request<Body>,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let user_id = request
        .extensions()
        .get::<AuthenticatedUser>()
        .map(|u| u.user_id.clone());

    let start = std::time::Instant::now();
    let response = next.run(request).await;
    let status = response.status().as_u16();
    let duration_ms = start.elapsed().as_millis();

    tracing::info!(
        target: "audit",
        %method,
        %path,
        %status,
        %duration_ms,
        user_id = user_id.as_deref().unwrap_or("-"),
        "request"
    );

    response
}
