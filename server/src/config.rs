use std::net::SocketAddr;
use std::path::PathBuf;

use secrecy::{ExposeSecret, SecretString};

use crate::crypto::SecretKey;

pub struct ServerConfig {
    pub bind_addr: SocketAddr,
    pub cors_origins: Option<Vec<String>>,
    pub data_dir: PathBuf,
    /// Seals every stored credential. Required: there is no plaintext mode.
    pub secret_key: SecretKey,
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
        let bind_addr = std::env::var("KEASY_BIND_ADDR")
            .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
            .parse()
            .unwrap_or_else(|e| fatal(&format!("KEASY_BIND_ADDR is not a socket address: {e}")));

        let cors_origins = std::env::var("KEASY_CORS_ORIGINS").ok().map(|v| {
            v.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        });

        let data_dir =
            PathBuf::from(std::env::var("KEASY_DATA_DIR").unwrap_or_else(|_| "./data".to_string()));

        let secret_key = match resolve_secret("KEASY_SECRET_KEY") {
            Some(encoded) => SecretKey::from_base64(encoded.expose_secret()).unwrap_or_else(|e| {
                fatal(&format!(
                    "KEASY_SECRET_KEY must be 32 random bytes in base64 \
                     (openssl rand -base64 32): it {e}"
                ))
            }),
            None => fatal(
                "KEASY_SECRET_KEY is required to encrypt stored credentials \
                 (generate one with: openssl rand -base64 32)",
            ),
        };

        // There is no unauthenticated mode to fall back to: a resource server that
        // cannot name its issuer cannot refuse anything.
        let oidc_issuer_url = nonblank("KEASY_OIDC_ISSUER_URL").unwrap_or_else(|| {
            fatal("KEASY_OIDC_ISSUER_URL is required — it is what tokens are validated against")
        });
        let oidc_client_id = nonblank("KEASY_OIDC_CLIENT_ID").unwrap_or_else(|| {
            fatal("KEASY_OIDC_CLIENT_ID is required — it names this workspace's client")
        });

        Self {
            bind_addr,
            cors_origins,
            data_dir,
            secret_key,
            oidc_issuer_url,
            oidc_client_id,
            oidc_audience: nonblank("KEASY_OIDC_AUDIENCE")
                .unwrap_or_else(|| "keasy-api".to_string()),
            oidc_internal_base_url: nonblank("KEASY_OIDC_INTERNAL_BASE_URL"),
            workspace_name: nonblank("KEASY_WORKSPACE_NAME")
                .unwrap_or_else(|| "Workspace".to_string()),
            workspace_slug: nonblank("KEASY_ORG_ALIAS"),
        }
    }
}

fn fatal(message: &str) -> ! {
    eprintln!("FATAL: {message}");
    std::process::exit(1);
}

/// An environment variable, or `None` when it is absent or blank.
fn nonblank(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `NAME_FILE` (a mounted secret) if set, else `NAME`.
fn resolve_secret(name: &str) -> Option<SecretString> {
    let file_var = format!("{name}_FILE");
    if let Ok(path) = std::env::var(&file_var) {
        let contents = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            fatal(&format!(
                "{file_var} points to {path} but could not read it: {e}"
            ))
        });
        return Some(SecretString::from(contents.trim().to_string()))
            .filter(|s| !s.expose_secret().is_empty());
    }
    nonblank(name).map(SecretString::from)
}
