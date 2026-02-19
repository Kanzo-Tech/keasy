pub mod cloud_accounts;
pub mod connections;
pub mod graph;
pub mod health;
pub mod jobs;
pub mod scripts;
pub mod settings;
pub mod validation;

use axum::{Json, Router, http::StatusCode, middleware, response::{IntoResponse, Response}};
use axum::extract::DefaultBodyLimit;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::AppState;
use crate::job::types::{ErrorDetail, ErrorEnvelope};
use crate::middleware::auth::api_key_auth;

pub(crate) fn error_response(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (
        status,
        Json(ErrorEnvelope {
            error: ErrorDetail {
                code: code.into(),
                message: message.into(),
            },
        }),
    )
        .into_response()
}

pub fn build_router(state: AppState, cors_origins: Option<Vec<String>>) -> Router {
    let health_routes = Router::new()
        .route("/healthz/live", axum::routing::get(health::liveness))
        .route("/healthz/ready", axum::routing::get(health::readiness))
        .with_state(state.clone());

    let public_api_routes = Router::new()
        .route(
            "/v1/settings/schema",
            axum::routing::get(settings::get_schema),
        )
        .with_state(state.clone());

    let api_routes = Router::new()
        .route(
            "/v1/jobs",
            axum::routing::get(jobs::list_jobs).post(jobs::create_job),
        )
        .route(
            "/v1/jobs/{id}",
            axum::routing::get(jobs::get_job).delete(jobs::delete_job),
        )
        .route(
            "/v1/jobs/{id}/cancel",
            axum::routing::post(jobs::cancel_job),
        )
        .route(
            "/v1/jobs/{id}/catalog",
            axum::routing::get(jobs::get_job_catalog),
        )
        .route(
            "/v1/jobs/{id}/graph",
            axum::routing::get(jobs::get_job_graph),
        )
        .route("/v1/graph", axum::routing::get(jobs::get_unified_graph))
        .route(
            "/v1/scripts/validate",
            axum::routing::post(scripts::validate_script),
        )
        .route(
            "/v1/settings/organization",
            axum::routing::get(settings::get_org_settings)
                .put(settings::save_org_settings),
        )
        .route(
            "/v1/settings/preferences",
            axum::routing::get(settings::get_preferences)
                .put(settings::save_preferences),
        )
        .route(
            "/v1/settings/ai",
            axum::routing::get(settings::get_ai_settings)
                .put(settings::save_ai_settings),
        )
        .route(
            "/v1/validate",
            axum::routing::post(validation::validate_job),
        )
        .route(
            "/v1/graph/search",
            axum::routing::post(graph::search_nodes),
        )
        .route(
            "/v1/graph/expand",
            axum::routing::post(graph::expand_node),
        )
        .route(
            "/v1/jobs/{id}/discover/load",
            axum::routing::post(graph::load_discover),
        )
        .route(
            "/v1/jobs/{id}/discover/query",
            axum::routing::post(graph::query_discover),
        )
        .route(
            "/v1/jobs/{id}/discover/chart",
            axum::routing::post(graph::chart_discover),
        )
        .route(
            "/v1/jobs/{id}/discover/export",
            axum::routing::get(graph::export_discover),
        )
        .route(
            "/v1/jobs/{id}/discover/ask",
            axum::routing::post(graph::ask_discover),
        )
        .route(
            "/v1/cloud-accounts",
            axum::routing::get(cloud_accounts::list_accounts)
                .post(cloud_accounts::create_account),
        )
        .route(
            "/v1/cloud-accounts/{id}",
            axum::routing::get(cloud_accounts::get_account)
                .put(cloud_accounts::update_account)
                .delete(cloud_accounts::delete_account),
        )
        .route(
            "/v1/connections",
            axum::routing::get(connections::list_connections)
                .post(connections::create_connection),
        )
        .route(
            "/v1/connections/{id}",
            axum::routing::delete(connections::delete_connection),
        )
        .route(
            "/v1/connections/{id}/files",
            axum::routing::get(connections::list_connection_files),
        )
        .route(
            "/v1/connections/{id}/files/download",
            axum::routing::get(connections::download_file),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            api_key_auth,
        ))
        .with_state(state);

    let cors = match cors_origins {
        Some(origins) => {
            let origins: Vec<_> = origins
                .iter()
                .filter_map(|o| o.parse().ok())
                .collect();
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
        }
        None => CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    };

    Router::new()
        .merge(health_routes)
        .merge(public_api_routes)
        .merge(api_routes)
        .layer(cors)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
}
