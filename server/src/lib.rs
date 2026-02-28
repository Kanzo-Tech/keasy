// server/src/lib.rs — Public API for integration tests.
// The binary crate (main.rs) uses `mod` declarations for all modules.
// This lib.rs re-exports what integration tests need.

pub mod ai;
pub mod auth;
pub mod cloud;
pub mod config;
pub mod connections;
pub mod crypto;
pub mod db;
pub mod discovery;
pub mod error;
pub mod gaia_x;
pub mod jobs;
pub mod keycloak;
pub mod middleware;
pub mod routes;
pub mod settings;
pub mod tenant;

// Re-export types integration tests need
pub use db::Database;
pub use discovery::graph_store::GraphStore;
pub use discovery::rdf_graph::RdfGraph;
pub use jobs::runner::JobRunner;

use secrecy::SecretString;
use std::num::NonZeroUsize;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct OutputCache(pub lru::LruCache<String, Arc<dyn GraphStore>>);

impl OutputCache {
    pub fn new(cap: usize) -> Self {
        Self(lru::LruCache::new(NonZeroUsize::new(cap).unwrap()))
    }
    pub fn get(&mut self, key: &str) -> Option<Arc<dyn GraphStore>> {
        self.0.get(key).cloned()
    }
    pub fn insert(&mut self, key: String, graph: Arc<dyn GraphStore>) -> Arc<dyn GraphStore> {
        self.0.put(key, graph.clone());
        graph
    }
    pub fn remove(&mut self, key: &str) {
        self.0.pop(key);
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub runner: Arc<JobRunner>,
    pub catalog: Arc<dyn GraphStore>,
    pub output_cache: Arc<Mutex<OutputCache>>,
    pub api_key: SecretString,
    pub base_url: String,
    /// HTTP client for calls to the walt.id Verifier API (wallet connection).
    /// None when KEASY_WALT_ID_VERIFIER_URL is not set.
    pub vc_client: Option<reqwest::Client>,
    /// GXDCH Notary endpoint URL for LRN credential requests.
    pub gxdch_notary_url: String,
    /// GXDCH Compliance Service endpoint URL for VP submission.
    pub gxdch_compliance_url: String,
    /// Keycloak OIDC issuer URL (internal Docker network).
    /// None when Keycloak is not configured.
    pub oidc_issuer_url: Option<String>,
    /// OIDC client_id for this Keasy instance.
    pub oidc_client_id: Option<String>,
    /// OIDC client_secret for admin API calls.
    pub oidc_client_secret: Option<SecretString>,
    /// Keycloak admin API client. None when OIDC is not configured.
    pub keycloak_admin: Option<keycloak::admin::KeycloakAdmin>,
    /// OIDC relying party state (client, JWKS cache, HTTP client).
    /// None when OIDC is not fully configured or when Keycloak was unreachable at startup.
    pub oidc_state: Option<Arc<crate::auth::oidc::OidcState>>,
}
