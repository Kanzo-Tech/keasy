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
    pub cache_capacity: usize,
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

        let cache_capacity = std::env::var("KEASY_CACHE_CAPACITY")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);

        Self {
            bind_addr,
            api_key: SecretString::from(api_key),
            max_concurrent_jobs,
            job_timeout_secs,
            shutdown_grace_secs,
            cors_origins,
            data_dir,
            secret_key,
            cache_capacity,
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
