use std::collections::HashMap;

use fossil_lang::traits::provider::FileReader;
use futures::StreamExt;
use object_store::ObjectStore;
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
                    size: meta.size,
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

pub struct CloudReader {
    inner: Box<dyn FileReader>,
    creds: HashMap<String, String>,
}

impl CloudReader {
    pub fn new(inner: Box<dyn FileReader>, creds: HashMap<String, String>) -> Self {
        Self { inner, creds }
    }
}

impl std::fmt::Debug for CloudReader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CloudReader").finish()
    }
}

impl FileReader for CloudReader {
    fn read_to_string(&self, url: &str) -> Result<String, String> {
        if super::is_cloud_url(url) {
            let handle = tokio::runtime::Handle::current();
            tokio::task::block_in_place(|| {
                handle.block_on(async {
                    let bytes = download(url, &self.creds).await?;
                    String::from_utf8(bytes).map_err(|e| e.to_string())
                })
            })
        } else {
            self.inner.read_to_string(url)
        }
    }
}

