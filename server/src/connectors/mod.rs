pub mod db;
pub mod models;
pub mod routes;
pub mod secrets;
pub mod types;

use axum::routing::{get, post};
use axum::Router;
use crate::AppState;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/connectors/kinds", get(routes::list_connector_kinds))
        .route(
            "/v1/connectors",
            get(routes::list_connectors).post(routes::create_connector),
        )
        .route(
            "/v1/connectors/{id}",
            get(routes::get_connector).put(routes::update_connector).delete(routes::delete_connector),
        )
        .route("/v1/connectors/{id}/test", post(routes::test_connector))
}
