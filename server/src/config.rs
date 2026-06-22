use std::net::SocketAddr;
use std::path::PathBuf;

use secrecy::{ExposeSecret, SecretString};

pub struct ServerConfig {
    pub bind_addr: SocketAddr,
    pub api_key: SecretString,
    pub cors_origins: Option<Vec<String>>,
    pub data_dir: PathBuf,
    pub secret_key: Option<SecretString>,
    /// Session cookie signing key — required. Read from KEASY_SESSION_SECRET.
    pub session_secret: SecretString,
    /// Set the Secure flag on session cookies (requires HTTPS).
    /// Read from KEASY_SESSION_SECURE. Default false (local dev).
    pub session_secure: bool,
    pub cache_capacity: usize,
    /// Base URL for the frontend — used to construct invite links.
    /// Read from KEASY_BASE_URL, default "http://localhost:3000".
    pub base_url: String,
    /// OIDC issuer URL. Discovery doc at {issuer}/.well-known/openid-configuration.
    /// Read from KEASY_OIDC_ISSUER_URL. Example: http://keycloak:8080/auth/realms/keasy
    pub oidc_issuer_url: Option<String>,
    /// OIDC client_id registered in Keycloak for this Keasy instance.
    /// Read from KEASY_OIDC_CLIENT_ID. Example: keasy-server
    pub oidc_client_id: Option<String>,
    /// OIDC client_secret for the keasy-server client. Used for admin API calls
    /// (client credentials flow) and the authorization code exchange.
    /// Read from KEASY_OIDC_CLIENT_SECRET.
    pub oidc_client_secret: Option<SecretString>,
    /// Internal base URL for reaching the OIDC provider (Keycloak) inside Docker.
    /// When set, OIDC discovery and token exchange rewrite the public issuer URL
    /// to this internal URL (e.g. `http://keycloak:8080`).
    /// Read from KEASY_OIDC_INTERNAL_BASE_URL.
    pub oidc_internal_base_url: Option<String>,
    /// Display name of this workspace. Read from `KEASY_WORKSPACE_NAME`,
    /// default `"Workspace"`. Used to seed the local workspace identity at boot.
    pub workspace_name: String,
    /// This instance's workspace slug. Read from `KEASY_ORG_ALIAS`. The "current"
    /// entry in the workspace switcher.
    pub workspace_slug: Option<String>,
    /// Session cookie name — allows multiple Keasy instances on the same host.
    /// Read from KEASY_SESSION_COOKIE_NAME. Default "keasy.sid".
    pub session_cookie_name: String,
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

        let data_dir = PathBuf::from(
            std::env::var("KEASY_DATA_DIR").unwrap_or_else(|_| "./data".to_string()),
        );

        let secret_key = resolve_secret("KEASY_SECRET_KEY");

        let session_secret = match resolve_secret("KEASY_SESSION_SECRET") {
            Some(s) => s,
            None => {
                eprintln!("FATAL: KEASY_SESSION_SECRET is required for session cookie signing");
                eprintln!("       Generate one with: openssl rand -base64 64");
                std::process::exit(1);
            }
        };

        let cache_capacity = std::env::var("KEASY_CACHE_CAPACITY")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);

        let base_url = std::env::var("KEASY_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:3000".to_string());

        let oidc_issuer_url = std::env::var("KEASY_OIDC_ISSUER_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let oidc_client_id = std::env::var("KEASY_OIDC_CLIENT_ID")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let oidc_client_secret = resolve_secret("KEASY_OIDC_CLIENT_SECRET");

        let oidc_internal_base_url = std::env::var("KEASY_OIDC_INTERNAL_BASE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let workspace_name = std::env::var("KEASY_WORKSPACE_NAME")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Workspace".to_string());

        let workspace_slug = std::env::var("KEASY_ORG_ALIAS")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let session_cookie_name = std::env::var("KEASY_SESSION_COOKIE_NAME")
            .unwrap_or_else(|_| "keasy.sid".to_string());

        let session_secure = std::env::var("KEASY_SESSION_SECURE")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        Self {
            bind_addr,
            api_key: SecretString::from(api_key),
            cors_origins,
            data_dir,
            secret_key,
            session_secret,
            session_secure,
            cache_capacity,
            base_url,
            oidc_issuer_url,
            oidc_client_id,
            oidc_client_secret,
            oidc_internal_base_url,
            workspace_name,
            workspace_slug,
            session_cookie_name,
        }
    }
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
