pub mod health;
pub mod org;

use axum::extract::DefaultBodyLimit;
use axum::http::HeaderValue;
use axum::http::header::{self, HeaderName};
use axum::{Router, middleware};
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::{DefaultOnResponse, TraceLayer};

use crate::AppState;
use crate::middleware::bearer::bearer_required;
use crate::middleware::tenant::tenant_context_required;

pub fn build_router(state: AppState, cors_origins: Option<Vec<String>>) -> Router {
    let health_routes = Router::new()
        .route("/healthz/live", axum::routing::get(health::liveness))
        .route("/healthz/ready", axum::routing::get(health::readiness))
        .route("/version", axum::routing::get(health::version))
        .with_state(state.clone());

    let public_api_routes = Router::new()
        .route(
            "/v1/settings/schema",
            axum::routing::get(crate::settings::routes::get_schema),
        )
        .with_state(state.clone());

    // Authenticated but not yet a member: someone who holds a valid token and no
    // role here still needs to be told which workspaces they *do* belong to.
    let member_agnostic_routes = Router::new()
        .route(
            "/v1/auth/workspaces",
            axum::routing::get(crate::auth::routes::list_workspaces),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            bearer_required,
        ))
        .with_state(state.clone());

    // All existing API routes, behind a verified token and a workspace role
    let api_routes = Router::new()
        .route(
            "/v1/jobs",
            axum::routing::get(crate::jobs::routes::list_jobs)
                .post(crate::jobs::routes::create_job),
        )
        .route(
            "/v1/jobs/{id}",
            axum::routing::get(crate::jobs::routes::get_job)
                .put(crate::jobs::routes::update_job)
                .patch(crate::jobs::routes::complete_job)
                .delete(crate::jobs::routes::delete_job),
        )
        .route(
            "/v1/settings/organization",
            axum::routing::get(crate::settings::routes::get_org_settings)
                .put(crate::settings::routes::save_org_settings),
        )
        .route(
            "/v1/settings/catalog-storage",
            axum::routing::get(crate::settings::routes::get_catalog_storage)
                .put(crate::settings::routes::save_catalog_storage),
        )
        .route(
            "/v1/settings/ai/providers",
            axum::routing::get(crate::settings::routes::list_ai_providers),
        )
        .route(
            "/v1/settings/ai/providers/{provider_id}",
            axum::routing::put(crate::settings::routes::save_ai_provider)
                .delete(crate::settings::routes::delete_ai_provider),
        )
        .route(
            "/v1/jobs/{id}/output/urls",
            axum::routing::post(crate::discovery::routes::resolve_output_urls),
        )
        .route(
            "/v1/jobs/{id}/source-refs",
            axum::routing::get(crate::discovery::routes::resolve_source_refs),
        )
        .route(
            "/v1/jobs/{id}/sources/urls",
            axum::routing::post(crate::discovery::routes::resolve_source_urls),
        )
        .route(
            "/v1/jobs/{id}/discover/urls",
            axum::routing::post(crate::discovery::routes::resolve_discover_urls),
        )
        .route(
            "/v1/jobs/{id}/relations",
            axum::routing::put(crate::jobs::routes::publish_relations),
        )
        .route(
            "/v1/catalog/datasets",
            axum::routing::get(crate::catalog::routes::list_catalog_datasets),
        )
        .route(
            "/v1/jobs/{id}/discover/ask-stream",
            axum::routing::post(crate::ai::routes::ask_discover_stream),
        )
        .route(
            "/v1/cloud-accounts",
            axum::routing::get(crate::cloud::routes::list_accounts)
                .post(crate::cloud::routes::create_account),
        )
        .route(
            "/v1/cloud-accounts/{id}",
            axum::routing::get(crate::cloud::routes::get_account)
                .put(crate::cloud::routes::update_account)
                .delete(crate::cloud::routes::delete_account),
        )
        .route(
            "/v1/connections",
            axum::routing::get(crate::connections::routes::list_connections)
                .post(crate::connections::routes::create_connection),
        )
        .route(
            "/v1/connections/{id}",
            axum::routing::get(crate::connections::routes::get_connection)
                .delete(crate::connections::routes::delete_connection),
        )
        .route(
            "/v1/connections/{id}/files",
            axum::routing::get(crate::connections::routes::list_connection_files),
        )
        .route(
            "/v1/connections/{id}/urls",
            axum::routing::post(crate::connections::routes::sign_connection_urls),
        )
        // Assistant (SSE streaming)
        .route(
            "/v1/assistant/suggest-stream",
            axum::routing::post(crate::assistant::routes::suggest_cqs_stream),
        )
        .route(
            "/v1/assistant/generate-stream",
            axum::routing::post(crate::assistant::routes::generate_script_stream),
        )
        // Workspace legal identity — read for any member, write for the owner
        .route(
            "/v1/org/identity",
            axum::routing::get(org::get_org_identity).put(org::update_org_identity),
        )
        .layer(middleware::from_fn(
            tenant_context_required, // runs second (inner), after bearer_required
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            bearer_required, // runs first (outer)
        ))
        .with_state(state);

    let cors = match cors_origins {
        Some(origins) => {
            let origins: Vec<_> = origins.iter().filter_map(|o| o.parse().ok()).collect();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
        }
        None => {
            if cfg!(debug_assertions) {
                tracing::warn!("CORS: allowing all origins (dev mode)");
                CorsLayer::permissive()
            } else {
                panic!("KEASY_CORS_ORIGINS must be set in production");
            }
        }
    };

    let security_headers = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-xss-protection"),
            HeaderValue::from_static("1; mode=block"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ));

    // Rate limiting — relaxed in dev to support DuckDB concurrent range requests
    let (rps, burst) = if cfg!(debug_assertions) {
        (100, 500)
    } else {
        (20, 100)
    };
    let governor_conf = tower_governor::governor::GovernorConfigBuilder::default()
        .per_second(rps)
        .burst_size(burst)
        .finish()
        .unwrap();

    // Rate-limited routes (excludes health checks so LB probes don't eat the budget)
    let rated_routes = Router::new()
        .merge(public_api_routes)
        .merge(member_agnostic_routes)
        .merge(api_routes)
        .layer(tower_governor::GovernorLayer::new(governor_conf));

    Router::new()
        .merge(health_routes)
        .merge(rated_routes)
        .layer(cors)
        .layer(security_headers)
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
}

#[cfg(test)]
mod tests;
