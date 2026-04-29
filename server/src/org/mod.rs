pub mod admin_handlers;
pub mod db;
pub mod handlers;
pub mod models;
pub mod repository;
pub mod service;

use axum::routing::{delete, get, put};
use axum::Router;
use crate::AppState;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/v1/admin/organizations",
            get(admin_handlers::list_all_orgs).post(admin_handlers::create_org_and_invite),
        )
        .route(
            "/v1/admin/invites",
            get(admin_handlers::list_invites).post(admin_handlers::create_invite),
        )
        .route("/v1/admin/invites/{token}", delete(admin_handlers::revoke_invite))
        .route(
            "/v1/org/identity",
            get(handlers::get_org_identity).put(handlers::update_org_identity),
        )
        .route("/v1/org/users", get(handlers::list_users))
        .route(
            "/v1/org/users/{id}",
            put(handlers::update_user_role).delete(handlers::remove_user),
        )
        .route(
            "/v1/org/invites",
            get(handlers::list_org_invites).post(handlers::create_org_invite),
        )
        .route("/v1/org/invites/{token}", delete(handlers::revoke_org_invite))
}
