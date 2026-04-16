use futures::StreamExt;
use serde::Serialize;

use super::models::Connector;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

pub async fn list_files(connector: &Connector) -> Result<Vec<FileEntry>, String> {
    let cc = connector.parse_config()?;
    let (store, prefix) = cc.build_store()?;

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
