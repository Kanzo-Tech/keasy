// server/src/lib.rs — Public API for integration tests.
// The binary crate (main.rs) uses `mod` declarations for all modules.
// This lib.rs re-exports what integration tests need.

pub mod ai;
pub mod assistant;
pub mod auth;
pub mod catalog;
pub mod cloud;
pub mod config;
pub mod connections;
pub mod crypto;
pub mod db;
pub mod discovery;
pub mod error;
pub mod jobs;
pub mod middleware;
pub mod openapi;
pub mod routes;
pub mod settings;

// Re-export types integration tests need
pub use db::Database;

use secrecy::SecretString;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub api_key: SecretString,
    /// This instance's workspace slug (`KEASY_ORG_ALIAS`). The "current" entry in the
    /// workspace switcher. None when not configured.
    pub workspace_slug: Option<String>,
    /// The whole of this server's authentication: a bearer token verified
    /// against the realm's JWKS. Required — there is no unauthenticated mode.
    pub auth: auth::jwt::SharedValidator,
    /// Server-side DuckLake catalog — the authority over output metadata. `None`
    /// when it could not be opened at startup (the host still serves jobs; the
    /// reconciler picks up unregistered datasets once it is available).
    pub catalog: Option<Arc<catalog::Catalog>>,
}
