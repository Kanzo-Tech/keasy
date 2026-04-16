pub mod models;
pub mod errors;
pub mod db;
pub mod routes;
pub mod pipeline_extract;
pub mod pipeline_types;

pub use pipeline_types::*;
pub use pipeline_extract::extract_summary_from_plan;

use axum::routing::get;
use axum::Router;
use crate::AppState;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/jobs", get(routes::list_jobs).post(routes::create_job))
        .route(
            "/v1/jobs/{id}",
            get(routes::get_job).put(routes::update_job).delete(routes::delete_job),
        )
        .route(
            "/v1/jobs/{id}/dashboard-layout",
            get(routes::get_dashboard_layout).put(routes::save_dashboard_layout),
        )
        .route(
            "/v1/jobs/{id}/discover/urls",
            get(crate::discovery::routes::resolve_discover_urls),
        )
}
