use std::collections::HashMap;

use futures::StreamExt;
use serde::Serialize;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub last_modified: Option<String>,
}


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

pub async fn upload(
    url: &str,
    content: Vec<u8>,
    creds: &HashMap<String, String>,
) -> Result<(), String> {
    let (store, path) = super::build_store(url, creds).map_err(|e| e.to_string())?;
    let payload = object_store::PutPayload::from(content);
    store
        .put(&path, payload)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn download(
    url: &str,
    creds: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    let (store, path) = super::build_store(url, creds).map_err(|e| e.to_string())?;
    let result = store.get(&path).await.map_err(|e| e.to_string())?;
    let bytes = result.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}
