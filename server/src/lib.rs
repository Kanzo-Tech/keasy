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
pub mod graph;
pub mod jobs;
pub use keasy_keycloak as keycloak;
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
    pub base_url: String,
    pub auth: AuthServices,
    /// Server-side DuckLake catalog — the authority over output metadata. `None`
    /// when it could not be opened at startup (the host still serves jobs; the
    /// reconciler picks up unregistered datasets once it is available).
    pub catalog: Option<Arc<catalog::Catalog>>,
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
    /// Keycloak Organization id of this workspace (resolved at startup from the
    /// configured alias). The membership container — members, invites, and the
    /// switcher all key off it. None when Keycloak/org is not configured.
    pub oidc_org_id: Option<String>,
    /// Central onboarding mode (the apex instance) — routes workspace-less users to
    /// onboarding and provisions via the control-plane.
    pub central_mode: bool,
    /// Control-plane base URL (internal) for provisioning (central mode only).
    pub control_plane_url: Option<String>,
    /// Shared key for the control-plane's mutating endpoints (central mode only).
    pub control_plane_key: Option<SecretString>,
}

