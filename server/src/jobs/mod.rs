pub mod models;
pub mod errors;
pub mod db;
pub mod handlers;
pub mod pipeline_extract;
pub mod pipeline_types;
pub mod repository;
pub mod service;

pub use pipeline_types::*;
pub use pipeline_extract::extract_summary_from_plan;

use axum::routing::get;
use axum::Router;
use crate::AppState;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/jobs", get(handlers::list_jobs).post(handlers::create_job))
        .route(
            "/v1/jobs/{id}",
            get(handlers::get_job).put(handlers::update_job).delete(handlers::delete_job),
        )
        .route(
            "/v1/jobs/{id}/dashboard-layout",
            get(handlers::get_dashboard_layout).put(handlers::save_dashboard_layout),
        )
        .route(
            "/v1/jobs/{id}/discover/urls",
            get(crate::discovery::routes::resolve_discover_urls),
        )
}
