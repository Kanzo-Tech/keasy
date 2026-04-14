//! Host-side path resolution.
//!
//! `ResolvedPath` wraps a URL + optional cloud credentials. `PathResolver`
//! is the trait keasy consumers implement to resolve `@connection/path`
//! references to actual storage URLs. These types live here — not in
//! fossil-lang — because resolution is entirely a host concern (language
//! compilers don't care how paths become URLs).

use std::collections::HashMap;

/// A resolved path ready for I/O: URL + cloud credentials.
#[derive(Clone)]
pub struct ResolvedPath {
    url: String,
    cloud_config: HashMap<String, String>,
}

impl ResolvedPath {
    pub fn new(url: &str, _cloud_options: Option<()>) -> Self {
        Self {
            url: url.to_string(),
            cloud_config: HashMap::new(),
        }
    }

    pub fn with_config(url: &str, cloud_config: HashMap<String, String>) -> Self {
        Self {
            url: url.to_string(),
            cloud_config,
        }
    }

    pub fn join(&self, rel: &str) -> Self {
        Self {
            url: format!("{}/{}", self.url.trim_end_matches('/'), rel),
            cloud_config: self.cloud_config.clone(),
        }
    }

    pub fn cloud_config(&self) -> &HashMap<String, String> {
        &self.cloud_config
    }

    pub fn to_str(&self) -> &str {
        &self.url
    }
}

impl std::fmt::Debug for ResolvedPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResolvedPath")
            .field("url", &self.url)
            .finish()
    }
}

/// Host-provided path resolution.
pub trait PathResolver: Send + Sync + std::fmt::Debug {
    fn resolve(&self, raw_path: &str) -> Result<ResolvedPath, String>;
}

#[derive(Debug)]
struct ConnectionInfo {
    base_url: String,
    /// Cloud configuration key-value pairs for the DuckDB engine.
    _cloud_config: Option<Vec<(String, String)>>,
}

/// Keasy-specific path resolver: resolves `@connection/path` references using
/// per-connection credentials. Direct paths are rejected.
#[derive(Debug)]
pub struct KeasyPathResolver {
    connections: HashMap<String, ConnectionInfo>,
}

impl KeasyPathResolver {
    pub fn from_connectors(
        connections: Vec<(String, String, Option<Vec<(String, String)>>)>,
    ) -> Self {
        let map = connections
            .into_iter()
            .map(|(name, base_url, cloud_config)| {
                (name, ConnectionInfo { base_url, _cloud_config: cloud_config })
            })
            .collect();
        Self { connections: map }
    }
}

impl PathResolver for KeasyPathResolver {
    fn resolve(&self, raw: &str) -> Result<ResolvedPath, String> {
        if !raw.starts_with('@') {
            return Err(format!(
                "Direct paths not allowed. Use @connection/path: {raw}"
            ));
        }
        let without_at = &raw[1..];
        let (name, path) = without_at
            .split_once('/')
            .ok_or_else(|| format!("Invalid reference: {raw}. Expected @name/path"))?;
        let conn = self
            .connections
            .get(name)
            .ok_or_else(|| format!("Unknown connection: @{name}"))?;
        let url = format!(
            "{}/{}",
            conn.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        );
        Ok(ResolvedPath::new(&url, None))
    }
}
