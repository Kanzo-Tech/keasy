pub mod ai;
pub mod db;
pub mod handlers;
pub mod org;
pub mod preferences;
pub mod providers;
pub mod repository;

use axum::routing::{get, put};
use axum::Router;
use crate::AppState;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/v1/settings/organization",
            get(handlers::get_org_settings).put(handlers::save_org_settings),
        )
        .route(
            "/v1/settings/preferences",
            get(handlers::get_preferences).put(handlers::save_preferences),
        )
        .route("/v1/internal/ai/resolve", get(handlers::resolve_ai_provider))
        .route("/v1/settings/ai/providers", get(handlers::list_ai_providers))
        .route(
            "/v1/settings/ai/providers/{provider_id}",
            put(handlers::save_ai_provider).delete(handlers::delete_ai_provider),
        )
}

/// Public settings routes — no auth required.
pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/providers", get(providers::list_providers))
}
