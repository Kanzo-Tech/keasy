//! Storage operations for connectors — file listing, upload.
//! Uses the ConnectorType trait to build CloudStore clients.

use futures::StreamExt;
use serde::Serialize;

use super::models::Connector;
use super::types::ConnectorRegistry;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

pub async fn list_files(
    registry: &ConnectorRegistry,
    connector: &Connector,
) -> Result<Vec<FileEntry>, String> {
    let ct = registry
        .get(&connector.connector_type)
        .ok_or_else(|| format!("unknown connector type: {}", connector.connector_type))?;

    let (store, prefix) = ct.build_store(&connector.config)?;

    let prefix_opt = if prefix.as_ref().is_empty() {
        None
    } else {
        Some(&prefix)
    };

    let mut entries = Vec::new();
    let mut stream = store.list(prefix_opt);
    while let Some(result) = stream.next().await {
        match result {
            Ok(meta) => entries.push(FileEntry {
                path: meta.location.to_string(),
                size: meta.size as u64,
                last_modified: Some(meta.last_modified.to_string()),
            }),
            Err(e) => return Err(format!("error listing files: {e}")),
        }
    }

    Ok(entries)
}
