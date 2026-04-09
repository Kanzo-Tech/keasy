// server/src/lib.rs — Public API for integration tests.
// The binary crate (main.rs) uses `mod` declarations for all modules.
// This lib.rs re-exports what integration tests need.

pub mod auth;
pub mod config;
pub mod connectors;
pub mod crypto;
pub mod db;
pub mod discovery;
pub mod error;
pub mod gaia_x;
pub mod graph;
pub mod jobs;
pub mod keycloak;
pub mod middleware;
pub mod openapi;
pub mod routes;
pub mod services;
pub mod settings;
pub mod sse;
pub mod tenant;


// Re-export types integration tests need
pub use db::Repos;
pub use jobs::runner::JobRunner;

use secrecy::SecretString;
use std::path::PathBuf;
use std::sync::Arc;

/// Hash a string using the default hasher (for cache keys, not cryptography).
pub fn hash_str(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

#[derive(Clone)]
pub struct AppState {
    pub repos: Repos,
    pub runner: Arc<JobRunner>,
    pub api_key: SecretString,
    pub base_url: String,
    pub auth: AuthServices,
    pub gaia_x: GaiaXServices,
    pub connector_registry: Arc<connectors::types::ConnectorRegistry>,
}

/// Authentication and identity services (Keycloak / OIDC).
#[derive(Clone)]
pub struct AuthServices {
    /// OIDC relying party state (client, JWKS cache, HTTP client).
    /// None when OIDC is not fully configured or when Keycloak was unreachable at startup.
    pub oidc_state: Option<Arc<crate::auth::oidc::OidcState>>,
    /// Keycloak admin API client. None when OIDC is not configured.
    pub keycloak_admin: Option<keycloak::admin::KeycloakAdmin>,
    /// Keycloak OIDC issuer URL (internal Docker network).
    /// None when Keycloak is not configured.
    pub oidc_issuer_url: Option<String>,
    /// OIDC client_id for this Keasy instance.
    pub oidc_client_id: Option<String>,
    /// OIDC client_secret for admin API calls.
    pub oidc_client_secret: Option<SecretString>,
}

/// Gaia-X external services (GXDCH).
#[derive(Clone)]
pub struct GaiaXServices {
    /// GXDCH client — Real (HTTP) or Mock (local JSON-LD).
    pub gxdch: crate::gaia_x::gxdch::GxdchClient,
    /// Base domain for org subdomains (e.g. "keasy.example.com").
    /// When set, .well-known endpoints resolve org via Host header subdomain.
    pub base_domain: Option<String>,
    /// Path to Caddy's data directory for reading TLS certificates.
    pub caddy_certs_dir: Option<PathBuf>,
}
