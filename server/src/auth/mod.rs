pub mod oidc;
pub mod routes;
pub mod session_store;

use axum::routing::{get, post};
use axum::Router;
use crate::AppState;

/// Public auth routes — no session required.
pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/auth/invite-info", get(routes::get_invite_info))
        .route("/v1/auth/oidc-start", get(oidc::oidc_start))
        .route("/v1/auth/oidc-callback", get(oidc::oidc_callback))
}

/// Session-authenticated auth routes — session required, no tenant context.
pub fn session_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/auth/logout", post(routes::logout))
        .route("/v1/auth/me", get(routes::get_me))
        .route("/v1/auth/workspaces", get(routes::list_workspaces))
}
