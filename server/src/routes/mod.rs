pub mod health;
pub mod providers;
pub mod scripts;

use axum::{Router, middleware};
use axum::extract::DefaultBodyLimit;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::AppState;
use crate::middleware::auth::api_key_auth;

pub fn build_router(state: AppState, cors_origins: Option<Vec<String>>) -> Router {
    let health_routes = Router::new()
        .route("/healthz/live", axum::routing::get(health::liveness))
        .route("/healthz/ready", axum::routing::get(health::readiness))
        .with_state(state.clone());

    let public_api_routes = Router::new()
        .route(
            "/v1/settings/schema",
            axum::routing::get(crate::settings::routes::get_schema),
        )
        .route(
            "/v1/providers",
            axum::routing::get(providers::list_providers),
        )
        .with_state(state.clone());

    let api_routes = Router::new()
        .route(
            "/v1/jobs",
            axum::routing::get(crate::jobs::routes::list_jobs).post(crate::jobs::routes::create_job),
        )
        .route(
            "/v1/jobs/{id}",
            axum::routing::get(crate::jobs::routes::get_job)
                .put(crate::jobs::routes::update_job)
                .delete(crate::jobs::routes::delete_job),
        )
        .route(
            "/v1/jobs/{id}/cancel",
            axum::routing::post(crate::jobs::routes::cancel_job),
        )
        .route(
            "/v1/jobs/{id}/catalog",
            axum::routing::get(crate::jobs::routes::get_job_catalog),
        )
        .route(
            "/v1/jobs/{id}/graph",
            axum::routing::get(crate::jobs::routes::get_job_graph),
        )
        .route("/v1/graph", axum::routing::get(crate::jobs::routes::get_unified_graph))
        .route(
            "/v1/scripts/validate",
            axum::routing::post(scripts::validate_script),
        )
        .route(
            "/v1/settings/organization",
            axum::routing::get(crate::settings::routes::get_org_settings)
                .put(crate::settings::routes::save_org_settings),
        )
        .route(
            "/v1/settings/preferences",
            axum::routing::get(crate::settings::routes::get_preferences)
                .put(crate::settings::routes::save_preferences),
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
            "/v1/validate",
            axum::routing::post(crate::discovery::validation_routes::validate_job),
        )
        .route(
            "/v1/graph/search",
            axum::routing::post(crate::discovery::routes::search_nodes),
        )
        .route(
            "/v1/graph/expand",
            axum::routing::post(crate::discovery::routes::expand_node),
        )
        .route(
            "/v1/jobs/{id}/dashboard-layout",
            axum::routing::get(crate::jobs::routes::get_dashboard_layout)
                .put(crate::jobs::routes::save_dashboard_layout),
        )
        .route(
            "/v1/jobs/{id}/discover/load",
            axum::routing::post(crate::discovery::routes::load_discover),
        )
        .route(
            "/v1/jobs/{id}/discover/query",
            axum::routing::post(crate::discovery::routes::query_discover),
        )
        .route(
            "/v1/jobs/{id}/discover/chart",
            axum::routing::post(crate::discovery::routes::chart_discover),
        )
        .route(
            "/v1/jobs/{id}/discover/export",
            axum::routing::get(crate::discovery::routes::export_discover),
        )
        .route(
            "/v1/jobs/{id}/discover/ask",
            axum::routing::post(crate::ai::routes::ask_discover),
        )
        .route(
            "/v1/jobs/{id}/conversations",
            axum::routing::get(crate::ai::routes::list_conversations)
                .post(crate::ai::routes::create_conversation),
        )
        .route(
            "/v1/conversations/{id}/messages",
            axum::routing::get(crate::ai::routes::get_conversation_messages),
        )
        .route(
            "/v1/conversations/{id}",
            axum::routing::put(crate::ai::routes::rename_conversation)
                .delete(crate::ai::routes::delete_conversation),
        )
        .route(
            "/v1/cloud-accounts",
            axum::routing::get(crate::cloud_accounts::routes::list_accounts)
                .post(crate::cloud_accounts::routes::create_account),
        )
        .route(
            "/v1/cloud-accounts/{id}",
            axum::routing::get(crate::cloud_accounts::routes::get_account)
                .put(crate::cloud_accounts::routes::update_account)
                .delete(crate::cloud_accounts::routes::delete_account),
        )
        .route(
            "/v1/connections",
            axum::routing::get(crate::connections::routes::list_connections)
                .post(crate::connections::routes::create_connection),
        )
        .route(
            "/v1/connections/{id}",
            axum::routing::get(crate::connections::routes::get_connection)
                .put(crate::connections::routes::update_connection)
                .delete(crate::connections::routes::delete_connection),
        )
        .route(
            "/v1/connections/{id}/files",
            axum::routing::get(crate::connections::routes::list_connection_files),
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
