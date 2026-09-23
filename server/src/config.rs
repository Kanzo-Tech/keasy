use std::net::SocketAddr;
use std::path::PathBuf;

use secrecy::{ExposeSecret, SecretString};

pub struct ServerConfig {
    pub bind_addr: SocketAddr,
    pub api_key: SecretString,
    pub cors_origins: Option<Vec<String>>,
    pub data_dir: PathBuf,
    pub secret_key: Option<SecretString>,
    pub cache_capacity: usize,
    /// The **public** OIDC issuer, exactly as it appears in a token's `iss`.
    /// Read from KEASY_OIDC_ISSUER_URL. Example: https://auth.example/auth/realms/keasy
    pub oidc_issuer_url: String,
    /// This workspace's Keycloak client. Two jobs: the expected `azp` on every
    /// token, and the key into `resource_access` that carries the roles.
    /// Read from KEASY_OIDC_CLIENT_ID. Example: keasy-ws-dev
    pub oidc_client_id: String,
    /// This API's audience — what the tenant client's audience mapper names, and
    /// what `aud` must contain. Read from KEASY_OIDC_AUDIENCE, default "keasy-api".
    pub oidc_audience: String,
    /// The **origin** at which this process reaches Keycloak, when that is not
    /// where the browser reaches it (`http://keycloak:8080`). Only the origin is
    /// replaced; the issuer's path is its own.
    /// Read from KEASY_OIDC_INTERNAL_BASE_URL.
    pub oidc_internal_base_url: Option<String>,
    /// Display name of this workspace. Read from `KEASY_WORKSPACE_NAME`,
    /// default `"Workspace"`. Used to seed the local workspace identity at boot.
    pub workspace_name: String,
    /// This instance's workspace slug. Read from `KEASY_ORG_ALIAS`. The "current"
    /// entry in the workspace switcher.
    pub workspace_slug: Option<String>,
}

impl ServerConfig {
    pub fn from_env() -> Self {
        let bind_addr = match std::env::var("KEASY_BIND_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
            .parse()
        {
            Ok(addr) => addr,
            Err(e) => {
                eprintln!("FATAL: KEASY_BIND_ADDR is not a valid socket address: {e}");
                std::process::exit(1);
            }
        };

        // Resolve via the `_FILE`-aware path so the key can arrive as a Swarm/Docker
        // secret mounted at `KEASY_API_KEY_FILE` (the deployment default) or as a
        // plain `KEASY_API_KEY` env (dev). `resolve_secret` already drops empties.
        let api_key = match resolve_secret("KEASY_API_KEY") {
            Some(key) => key.expose_secret().to_string(),
            None => {
                eprintln!("FATAL: KEASY_API_KEY (or KEASY_API_KEY_FILE) is required");
                std::process::exit(1);
            }
        };

        let cors_origins = std::env::var("KEASY_CORS_ORIGINS").ok().map(|v| {
            v.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        });

        let data_dir =
            PathBuf::from(std::env::var("KEASY_DATA_DIR").unwrap_or_else(|_| "./data".to_string()));

        let secret_key = resolve_secret("KEASY_SECRET_KEY");

        let cache_capacity = std::env::var("KEASY_CACHE_CAPACITY")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);

        // Both are required, and the server refuses to start without them. There
        // is no unauthenticated mode to fall back to: a resource server that
        // cannot name its issuer cannot refuse anything.
        let oidc_issuer_url = match nonblank("KEASY_OIDC_ISSUER_URL") {
            Some(v) => v,
            None => {
                eprintln!(
                    "FATAL: KEASY_OIDC_ISSUER_URL is required — it is what tokens are validated against"
                );
                std::process::exit(1);
            }
        };

        let oidc_client_id = match nonblank("KEASY_OIDC_CLIENT_ID") {
            Some(v) => v,
            None => {
                eprintln!(
                    "FATAL: KEASY_OIDC_CLIENT_ID is required — it names this workspace's client"
                );
                std::process::exit(1);
            }
        };

        let oidc_audience =
            nonblank("KEASY_OIDC_AUDIENCE").unwrap_or_else(|| "keasy-api".to_string());

        let oidc_internal_base_url = nonblank("KEASY_OIDC_INTERNAL_BASE_URL");

        let workspace_name = std::env::var("KEASY_WORKSPACE_NAME")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Workspace".to_string());

        let workspace_slug = nonblank("KEASY_ORG_ALIAS");

        Self {
            bind_addr,
            api_key: SecretString::from(api_key),
            cors_origins,
            data_dir,
            secret_key,
            cache_capacity,
            oidc_issuer_url,
            oidc_client_id,
            oidc_audience,
            oidc_internal_base_url,
            workspace_name,
            workspace_slug,
        }
    }
}

/// An environment variable, or `None` when it is absent or blank.
fn nonblank(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn resolve_secret(name: &str) -> Option<SecretString> {
    let file_var = format!("{name}_FILE");
    if let Ok(path) = std::env::var(&file_var) {
        match std::fs::read_to_string(&path) {
            Ok(contents) => {
                let trimmed = contents.trim().to_string();
                if !trimmed.is_empty() {
                    return Some(SecretString::from(trimmed));
                }
            }
            Err(e) => {
                eprintln!("FATAL: {file_var} points to {path} but could not read it: {e}");
                std::process::exit(1);
            }
        }
    }

    std::env::var(name)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(SecretString::from)
}
