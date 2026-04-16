pub mod admin;
pub mod invite_tokens;
pub mod org_members;
pub mod organizations;
pub mod routes;

use axum::routing::{get, put, delete};
use axum::Router;
use crate::AppState;

pub fn api_routes() -> Router<AppState> {
    Router::new()
        // Admin routes — promotor only
        .route(
            "/v1/admin/organizations",
            get(admin::list_all_orgs).post(admin::create_org_and_invite),
        )
        .route(
            "/v1/admin/invites",
            get(admin::list_invites).post(admin::create_invite),
        )
        .route("/v1/admin/invites/{token}", delete(admin::revoke_invite))
        .route(
            "/v1/admin/oidc-clients",
            get(admin::list_dataspaces).post(admin::register_dataspace),
        )
        // Org identity
        .route(
            "/v1/org/identity",
            get(routes::get_org_identity).put(routes::update_org_identity),
        )
        .route("/v1/org/users", get(routes::list_users))
        .route(
            "/v1/org/users/{id}",
            put(routes::update_user_role).delete(routes::remove_user),
        )
        .route(
            "/v1/org/invites",
            get(routes::list_org_invites).post(routes::create_org_invite),
        )
        .route("/v1/org/invites/{token}", delete(routes::revoke_org_invite))
}
