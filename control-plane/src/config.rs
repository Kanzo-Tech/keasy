//! Control-plane configuration, read from the environment at startup.

use secrecy::SecretString;

/// Static configuration the provisioner needs to talk to the shared Keycloak
/// and to template the instance stacks it brings up.
#[derive(Clone)]
pub struct ControlPlaneConfig {
    /// Address the control-plane HTTP API binds to (e.g. `0.0.0.0:9000`).
    pub bind_addr: String,

    // ── Shared Keycloak (admin service account) ──────────────────────────
    /// Public OIDC issuer URL of the shared Keycloak (`{base}/realms/{realm}`).
    pub oidc_issuer_url: String,
    /// Admin client_id (service account) the control-plane authenticates as.
    pub oidc_client_id: String,
    /// Admin client secret.
    pub oidc_client_secret: SecretString,
    /// Internal base URL for reaching Keycloak inside Docker (`http://keycloak:8080`).
    pub oidc_internal_base_url: Option<String>,

    // ── Instance templating ──────────────────────────────────────────────
    /// Base domain workspaces are served under (`{slug}.{base_domain}`).
    pub base_domain: String,
    /// Container image used for each instance's keasy-server.
    pub server_image: String,
    /// Container image used for each instance's web frontend.
    pub web_image: String,
    /// Docker network the instance containers attach to (shared with Keycloak).
    pub network: String,
}

impl ControlPlaneConfig {
    /// Read the configuration from the environment. Returns a human-readable
    /// error naming the first missing required variable.
    pub fn from_env() -> Result<Self, String> {
        let req = |key: &str| -> Result<String, String> {
            std::env::var(key)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| format!("missing required env var {key}"))
        };
        let opt = |key: &str| std::env::var(key).ok().filter(|v| !v.trim().is_empty());

        Ok(Self {
            bind_addr: opt("CP_BIND_ADDR").unwrap_or_else(|| "0.0.0.0:9000".to_string()),
            oidc_issuer_url: req("CP_OIDC_ISSUER_URL")?,
            oidc_client_id: req("CP_OIDC_CLIENT_ID")?,
            oidc_client_secret: SecretString::from(req("CP_OIDC_CLIENT_SECRET")?),
            oidc_internal_base_url: opt("CP_OIDC_INTERNAL_BASE_URL"),
            base_domain: opt("CP_BASE_DOMAIN").unwrap_or_else(|| "keasy.local".to_string()),
            server_image: opt("CP_SERVER_IMAGE").unwrap_or_else(|| "keasy-server:latest".to_string()),
            web_image: opt("CP_WEB_IMAGE").unwrap_or_else(|| "keasy-web:latest".to_string()),
            network: opt("CP_NETWORK").unwrap_or_else(|| "keasy_default".to_string()),
        })
    }
}
