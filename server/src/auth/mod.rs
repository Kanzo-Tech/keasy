pub mod handlers;
pub mod oidc;
pub mod session_store;

use axum::routing::{get, post};
use axum::Router;
use crate::AppState;

pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/auth/invite-info", get(handlers::get_invite_info))
        .route("/v1/auth/oidc-start", get(oidc::oidc_start))
        .route("/v1/auth/oidc-callback", get(oidc::oidc_callback))
}

pub fn session_routes() -> Router<AppState> {
    Router::new()
        .route("/v1/auth/logout", post(handlers::logout))
        .route("/v1/auth/me", get(handlers::get_me))
        .route("/v1/auth/workspaces", get(handlers::list_workspaces))
}
