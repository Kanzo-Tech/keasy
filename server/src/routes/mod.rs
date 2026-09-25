pub mod health;
pub mod org;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::http::{Request, StatusCode};
use axum::response::Response;
use axum::{Router, middleware};
use keasy_api::{ApiDoc, ErrorCode};
use tower_governor::GovernorError;
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::KeyExtractor;
use tower_http::trace::{DefaultOnResponse, TraceLayer};
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;

use crate::AppState;
use crate::auth::bearer::{AuthenticatedUser, bearer_required};
use crate::error::fail;

/// Every route, once: the public ones, and those behind a verified token. Each
/// handler's role extractor says whom it admits; the workspace list admits a
/// verified caller with no role here, who still needs to be told where they do
/// belong.
fn routes() -> (OpenApiRouter<AppState>, OpenApiRouter<AppState>) {
    let public = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(health::router())
        .merge(crate::settings::routes::public_router());
    let protected = OpenApiRouter::new()
        .merge(crate::auth::routes::router())
        .merge(crate::jobs::routes::router())
        .merge(crate::jobs::datasets::router())
        .merge(crate::discovery::routes::router())
        .merge(crate::connections::routes::router())
        .merge(crate::cloud::routes::router())
        .merge(crate::settings::routes::router())
        .merge(crate::ai::routes::router())
        .merge(crate::assistant::routes::router())
        .merge(org::router());
    (public, protected)
}

/// The contract the routes publish.
pub fn openapi() -> utoipa::openapi::OpenApi {
    let (public, protected) = routes();
    let mut api = public.merge(protected).into_openapi();
    keasy_api::error::document_refusals(&mut api);
    api
}

pub fn build_router(state: AppState) -> Router {
    let (public, protected) = routes();
    // Per caller: 20 requests a second with bursts of 100, relaxed in dev.
    let (period_ms, burst) = if cfg!(debug_assertions) {
        (10, 500)
    } else {
        (50, 100)
    };
    let per_caller = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(Subject)
            .per_millisecond(period_ms)
            .burst_size(burst)
            .finish()
            .expect("a non-zero period and burst"),
    );
    let protected = protected
        .layer(GovernorLayer::new(per_caller).error_handler(over_rate))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            bearer_required,
        ));
    let (router, _) = public.merge(protected).split_for_parts();

    router
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(
            // The one request log. `bearer_required` records `user_id` into this
            // span once the token verifies, so the response line names the caller.
            TraceLayer::new_for_http()
                .make_span_with(|request: &axum::http::Request<_>| {
                    tracing::info_span!(
                        "request",
                        method = %request.method(),
                        path = %request.uri().path(),
                        user_id = tracing::field::Empty,
                    )
                })
                .on_response(DefaultOnResponse::new().level(tracing::Level::INFO)),
        )
        .with_state(state)
}

/// Keyed by who is calling, not from where. Every request reaches this server
/// from the web's BFF, so the peer address is one address for the whole
/// workspace; the verified token's subject is the only per-caller identity at
/// this layer. Shedding anonymous floods by client address is the ingress's job,
/// where that address is still known.
#[derive(Clone)]
struct Subject;

impl KeyExtractor for Subject {
    type Key = String;

    fn extract<T>(&self, req: &Request<T>) -> Result<String, GovernorError> {
        req.extensions()
            .get::<AuthenticatedUser>()
            .map(|user| user.user_id.clone())
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

/// The refusal a caller over their rate gets.
fn over_rate(error: GovernorError) -> Response {
    match error {
        GovernorError::TooManyRequests { .. } => fail(
            StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::RateLimited,
            "Too many requests",
        ),
        _ => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::InternalError,
            "An internal error occurred",
        ),
    }
}

#[cfg(test)]
mod tests;
