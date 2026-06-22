//! Control-plane configuration, read from the environment at startup.

use secrecy::SecretString;

/// Static configuration the provisioner needs to talk to the shared Keycloak
/// and to template the instance stacks it brings up.
#[derive(Clone)]
pub struct ControlPlaneConfig {
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
    /// Shared external Swarm overlay the instance services + Traefik attach to
    /// (the ingress edge network).
    pub network: String,
    /// Base replica URL for Litestream, into a keasy-operated bucket — each
    /// tenant's SQLite stores replicate under `{base}/{workspace_id}/…`. `None`
    /// disables durability (the rendered server runs without Litestream). The
    /// replica credentials are the shared external secret `keasy-litestream`.
    pub litestream_replica_base: Option<String>,
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

        // `_FILE`-aware: prefers `<KEY>_FILE` (a mounted Swarm/Docker secret) over
        // the plain env, so the admin secret never lands in the environment.
        let secret = |key: &str| -> Result<SecretString, String> {
            let file_var = format!("{key}_FILE");
            if let Ok(path) = std::env::var(&file_var) {
                let contents = std::fs::read_to_string(&path)
                    .map_err(|e| format!("{file_var} points to {path} but could not read it: {e}"))?;
                let trimmed = contents.trim().to_string();
                if !trimmed.is_empty() {
                    return Ok(SecretString::from(trimmed));
                }
            }
            req(key).map(SecretString::from)
        };

        Ok(Self {
            oidc_issuer_url: req("CP_OIDC_ISSUER_URL")?,
            oidc_client_id: req("CP_OIDC_CLIENT_ID")?,
            oidc_client_secret: secret("CP_OIDC_CLIENT_SECRET")?,
            oidc_internal_base_url: opt("CP_OIDC_INTERNAL_BASE_URL"),
            base_domain: opt("CP_BASE_DOMAIN").unwrap_or_else(|| "keasy.local".to_string()),
            server_image: opt("CP_SERVER_IMAGE").unwrap_or_else(|| "keasy-server:latest".to_string()),
            web_image: opt("CP_WEB_IMAGE").unwrap_or_else(|| "keasy-web:latest".to_string()),
            network: opt("CP_NETWORK").unwrap_or_else(|| "keasy-edge".to_string()),
            litestream_replica_base: opt("CP_LITESTREAM_REPLICA_BASE"),
        })
    }
}
