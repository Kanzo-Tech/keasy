pub mod config;
pub mod db;
pub mod handlers;
pub mod models;
pub mod repository;
pub mod service;

use axum::routing::{get, post};
use axum::Router;
use crate::AppState;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/connectors/kinds", get(handlers::list_connector_kinds))
        .route(
            "/v1/connectors",
            get(handlers::list_connectors).post(handlers::create_connector),
        )
        .route(
            "/v1/connectors/{id}",
            get(handlers::get_connector).put(handlers::update_connector).delete(handlers::delete_connector),
        )
        .route("/v1/connectors/{id}/test", post(handlers::test_connector))
}
