use std::net::SocketAddr;
use std::path::PathBuf;

use secrecy::SecretString;

pub struct ServerConfig {
    pub bind_addr: SocketAddr,
    pub api_key: SecretString,
    pub max_concurrent_jobs: usize,
    pub job_timeout_secs: u64,
    pub shutdown_grace_secs: u64,
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
    /// GXDCH Notary API base URL for LRN credential requests.
    /// Read from KEASY_GXDCH_NOTARY_URL. Default: staging Notary endpoint.
    pub gxdch_notary_url: String,
    /// GXDCH Compliance Service URL for VP submission.
    /// Read from KEASY_GXDCH_COMPLIANCE_URL. Default: main/stable Compliance endpoint.
    pub gxdch_compliance_url: String,
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
    /// Base domain for org subdomains (e.g. "keasy.example.com").
    /// When set, each org gets `{slug}.{base_domain}` for did:web resolution.
    /// Read from KEASY_BASE_DOMAIN.
    pub base_domain: Option<String>,
    /// Path to an external SQL seed file executed at startup.
    /// Read from KEASY_SEED_FILE. Default None — no seed data.
    pub seed_file: Option<PathBuf>,
    /// Session cookie name — allows multiple Keasy instances on the same host.
    /// Read from KEASY_SESSION_COOKIE_NAME. Default "keasy.sid".
    pub session_cookie_name: String,
    /// Path to Caddy's data directory for reading TLS certificates.
    /// Read from KEASY_CADDY_CERTS_DIR.
    pub caddy_certs_dir: Option<PathBuf>,
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

        let api_key = match std::env::var("KEASY_API_KEY") {
            Ok(key) => key,
            Err(_) => {
                eprintln!("FATAL: KEASY_API_KEY environment variable is required");
                std::process::exit(1);
            }
        };

        if api_key.trim().is_empty() {
            eprintln!("FATAL: KEASY_API_KEY must not be empty");
            std::process::exit(1);
        }

        let max_concurrent_jobs = std::env::var("KEASY_MAX_CONCURRENT_JOBS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(4);

        let job_timeout_secs = std::env::var("KEASY_JOB_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(300);

        let shutdown_grace_secs = std::env::var("KEASY_SHUTDOWN_GRACE_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);

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

        let gxdch_notary_url = std::env::var("KEASY_GXDCH_NOTARY_URL")
            .unwrap_or_else(|_| crate::gaia_x::gxdch::GXDCH_NOTARY_URL.to_string());
        let gxdch_compliance_url = std::env::var("KEASY_GXDCH_COMPLIANCE_URL")
            .unwrap_or_else(|_| crate::gaia_x::gxdch::GXDCH_COMPLIANCE_URL.to_string());

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

        let base_domain = std::env::var("KEASY_BASE_DOMAIN")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let seed_file = std::env::var("KEASY_SEED_FILE")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from);

        let session_cookie_name = std::env::var("KEASY_SESSION_COOKIE_NAME")
            .unwrap_or_else(|_| "keasy.sid".to_string());

        let session_secure = std::env::var("KEASY_SESSION_SECURE")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        let caddy_certs_dir = std::env::var("KEASY_CADDY_CERTS_DIR")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from);

        Self {
            bind_addr,
            api_key: SecretString::from(api_key),
            max_concurrent_jobs,
            job_timeout_secs,
            shutdown_grace_secs,
            cors_origins,
            data_dir,
            secret_key,
            session_secret,
            session_secure,
            cache_capacity,
            base_url,
            gxdch_notary_url,
            gxdch_compliance_url,
            oidc_issuer_url,
            oidc_client_id,
            oidc_client_secret,
            oidc_internal_base_url,
            base_domain,
            seed_file,
            session_cookie_name,
            caddy_certs_dir,
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
