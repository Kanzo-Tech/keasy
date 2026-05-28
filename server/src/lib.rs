// server/src/lib.rs — Public API for integration tests.
// The binary crate (main.rs) uses `mod` declarations for all modules.
// This lib.rs re-exports what integration tests need.

pub mod ai;
pub mod assistant;
pub mod auth;
pub mod cloud;
pub mod config;
pub mod connections;
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
pub mod settings;
pub mod tenant;


// Re-export types integration tests need
pub use db::Database;
pub use jobs::runner::JobRunner;

use secrecy::SecretString;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Hash a string using the default hasher (for cache keys, not cryptography).
pub fn hash_str(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Per-org fossil analysis state: compilation host cache + per-doc text cache.
/// Stored in a single LRU so eviction is consistent.
///
/// The `docs` cache holds the latest full text per `textDocument.uri`. Used by
/// the JSON-RPC LSP route (`routes::fossil_lsp`): didOpen/didChange WRITE to
/// `docs`, then completion/hover READ from it. The custom `/v1/fossil/analyze`
/// route does NOT touch `docs` (it carries the source in the request body).
///
/// Locking discipline: take the `docs` lock briefly (insert-and-drop or
/// get-cloned-and-drop) so it never overlaps the `host` lock — prevents a
/// deadlock if two dispatches race on the same org.
pub struct OrgAnalysisState {
    pub host: Arc<Mutex<fossil_lsp::AnalysisHost>>,
    pub docs: Arc<Mutex<HashMap<String, String>>>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub runner: Arc<JobRunner>,
    pub api_key: SecretString,
    pub base_url: String,
    pub auth: AuthServices,
    pub gaia_x: GaiaXServices,
    /// Per-org fossil analysis state (compilation host + resolve cache).
    pub org_analysis: Arc<Mutex<lru::LruCache<String, OrgAnalysisState>>>,
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
