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
pub mod openapi;
pub mod routes;
pub mod settings;
pub mod tenant;

// Re-export types integration tests need
pub use db::Database;
pub use discovery::rdf_graph::RdfGraph;
pub use jobs::runner::JobRunner;

use secrecy::SecretString;
use std::num::NonZeroUsize;
use std::sync::Arc;


#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub runner: Arc<JobRunner>,
    pub catalog: Arc<RdfGraph>,
    pub api_key: SecretString,
    pub base_url: String,
    pub auth: AuthServices,
    pub gaia_x: GaiaXServices,
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

/// Gaia-X external services (GXDCH, wallet, issuer).
#[derive(Clone)]
pub struct GaiaXServices {
    /// HTTP client for calls to the walt.id Verifier API (wallet connection).
    /// None when KEASY_WALT_ID_VERIFIER_URL is not set.
    pub vc_client: Option<reqwest::Client>,
    /// walt.id Verifier API base URL (e.g. http://waltid-verifier-api:3000).
    /// Set together with vc_client from KEASY_WALT_ID_VERIFIER_URL.
    pub walt_id_verifier_url: Option<String>,
    /// HTTP client for calls to the walt.id Issuer API (OID4VCI credential export).
    /// None when KEASY_WALT_ID_ISSUER_URL is not set.
    pub issuer_client: Option<reqwest::Client>,
    /// walt.id Issuer API base URL (e.g. http://waltid-issuer-api:3000).
    pub walt_id_issuer_url: Option<String>,
    /// GXDCH Notary endpoint URL for LRN credential requests.
    pub gxdch_notary_url: String,
    /// GXDCH Compliance Service endpoint URL for VP submission.
    pub gxdch_compliance_url: String,
    /// Base domain for org subdomains (e.g. "keasy.example.com").
    /// When set, .well-known endpoints resolve org via Host header subdomain.
    pub base_domain: Option<String>,
}
