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
    /// Plan 03 wires this into the tower-sessions middleware.
    #[allow(dead_code)]
    pub session_secret: SecretString,
    pub cache_capacity: usize,
    /// Base URL for the frontend — used to construct invite links.
    /// Read from KEASY_BASE_URL, default "http://localhost:3000".
    pub base_url: String,
    /// Walt.id Verifier API base URL. When set, VC authentication is enabled.
    /// Read from KEASY_WALT_ID_VERIFIER_URL. Default None — VC auth disabled.
    pub walt_id_verifier_url: Option<String>,
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

        let walt_id_verifier_url = std::env::var("KEASY_WALT_ID_VERIFIER_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let gxdch_notary_url = std::env::var("KEASY_GXDCH_NOTARY_URL").unwrap_or_else(|_| {
            "https://registrationnumber.notary.lab.gaia-x.eu/v1/registrationNumberVC".to_string()
        });
        let gxdch_compliance_url =
            std::env::var("KEASY_GXDCH_COMPLIANCE_URL").unwrap_or_else(|_| {
                "https://compliance.lab.gaia-x.eu/main/api/credential-offers".to_string()
            });

        let oidc_issuer_url = std::env::var("KEASY_OIDC_ISSUER_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let oidc_client_id = std::env::var("KEASY_OIDC_CLIENT_ID")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let oidc_client_secret = resolve_secret("KEASY_OIDC_CLIENT_SECRET");

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
            cache_capacity,
            base_url,
            walt_id_verifier_url,
            gxdch_notary_url,
            gxdch_compliance_url,
            oidc_issuer_url,
            oidc_client_id,
            oidc_client_secret,
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
