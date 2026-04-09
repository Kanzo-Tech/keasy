use std::collections::HashMap;

use fossil_lang::traits::resolver::{PathResolver, ResolvedPath};

#[derive(Debug)]
struct ConnectionInfo {
    base_url: String,
    /// Cloud configuration key-value pairs.
    /// TODO: Previously stored Polars CloudOptions; now stores raw pairs.
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
        // TODO: ResolvedPath no longer wraps CloudOptions.
        Ok(ResolvedPath::new(&url, None))
    }
}
