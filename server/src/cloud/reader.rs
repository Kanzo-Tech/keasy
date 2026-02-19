use std::collections::HashMap;

use object_store::ObjectStore;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

/// List files in a cloud container.
pub async fn list_files(
    container_url: &str,
    creds: &HashMap<String, String>,
) -> Result<Vec<FileEntry>, String> {
    let (store, prefix) = super::build_store(container_url, creds).map_err(|e| e.to_string())?;

    let prefix_opt = if prefix.as_ref().is_empty() {
        None
    } else {
        Some(&prefix)
    };

    let mut entries = Vec::new();
    let list = store
        .list(prefix_opt)
        .collect::<Vec<_>>()
        .await;

    for result in list {
        match result {
            Ok(meta) => {
                entries.push(FileEntry {
                    path: meta.location.to_string(),
                    size: meta.size as u64,
                    last_modified: Some(meta.last_modified.to_string()),
                });
            }
            Err(e) => return Err(format!("Error listing files: {e}")),
        }
    }

    Ok(entries)
}

/// Download a file from a cloud container.
pub async fn download_file(
    container_url: &str,
    file_path: &str,
    creds: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    let (store, _) = super::build_store(container_url, creds).map_err(|e| e.to_string())?;
    let path = object_store::path::Path::parse(file_path).map_err(|e| e.to_string())?;
    let result = store.get(&path).await.map_err(|e| e.to_string())?;
    let bytes = result.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

/// Download a file directly from a full cloud URL (e.g. az://container/path/file.ttl).
pub async fn download_from_url(
    url: &str,
    creds: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    let (store, path) = super::build_store(url, creds).map_err(|e| e.to_string())?;
    let result = store.get(&path).await.map_err(|e| e.to_string())?;
    let bytes = result.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

// We need the futures StreamExt for collect
use futures::StreamExt;
