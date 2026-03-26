use std::collections::HashMap;

use fossil_lang::traits::resolver::{PathResolver, ResolvedPath};
use polars::prelude::cloud::CloudOptions;
use polars::prelude::{PlPath, PlPathRef};

#[derive(Debug)]
struct ConnectionInfo {
    base_url: String,
    cloud_options: Option<CloudOptions>,
    credentials: HashMap<String, String>,
}

/// Keasy-specific path resolver: resolves `@connection/path` references using
/// per-connection credentials. Direct paths are rejected.
#[derive(Debug)]
pub struct KeasyPathResolver {
    connections: HashMap<String, ConnectionInfo>,
}

impl KeasyPathResolver {
    pub fn from_connections(
        connections: Vec<(String, String, HashMap<String, String>)>,
    ) -> Self {
        let map = connections
            .into_iter()
            .map(|(name, base_url, credentials)| {
                let cloud_options = build_cloud_options(&base_url, &credentials);
                (name, ConnectionInfo { base_url, cloud_options, credentials })
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
        Ok(ResolvedPath::with_config(
            &url,
            conn.cloud_options.clone(),
            conn.credentials.clone(),
        ))
    }
}

pub fn build_cloud_options(url: &str, config: &HashMap<String, String>) -> Option<CloudOptions> {
    if config.is_empty() {
        return None;
    }
    let path = PlPath::from_str(url);
    match path.as_ref() {
        PlPathRef::Local(_) => None,
        PlPathRef::Cloud(cloud_path) => {
            let scheme = cloud_path.scheme();
            let pairs: Vec<(&str, &str)> = config
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            CloudOptions::from_untyped_config(Some(&scheme), pairs).ok()
        }
    }
}
