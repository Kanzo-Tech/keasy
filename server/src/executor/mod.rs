pub mod builders;
pub mod duckdb;
pub mod engine;
pub mod fossil;
pub mod fossil_analysis;
pub mod path_resolver;
pub mod runner;
pub mod script;
pub mod scripts;

use axum::routing::post;
use axum::Router;
use crate::AppState;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/scripts/validate", post(scripts::validate_script))
        .route("/v1/fossil/analyze", post(fossil_analysis::analyze))
}
