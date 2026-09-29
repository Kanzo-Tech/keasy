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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::{CloudStore, build_store};
    use object_store::ObjectStore;

    /// Connectivity test: write, list, read back and delete one object
    /// against a live S3-compatible endpoint — the local MinIO from
    /// `make dev-minio` — through the same `reader` functions the connection
    /// routes use.
    ///
    /// `#[ignore]` because it needs a live S3 endpoint + creds. Run it inside
    /// the server container while `make dev-minio` is up:
    ///
    /// ```sh
    /// export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
    ///        AWS_DEFAULT_REGION=… AWS_ENDPOINT_URL=…           # the MinIO creds
    /// export KEASY_MINIO_TEST_URL=s3://connector-test/
    /// cargo test --lib cloud::reader::tests::round_trips_an_object_through_minio \
    ///   -- --ignored --nocapture
    /// ```
    ///
    /// Limitations:
    /// - If a step fails midway, the test stops before the cleanup and leaves
    ///   one small object under `keasy-connectivity-test/` in the bucket
    ///   (delete it from the MinIO console at http://localhost:9001).
    /// - It covers the server-side storage layer (`reader` + object_store)
    ///   only: not the HTTP API/auth, nor the browser path that jobs use
    ///   (presigned URLs fetched by the browser).
    #[tokio::test]
    #[ignore = "needs live S3 endpoint + creds (make dev-minio)"]
    async fn round_trips_an_object_through_minio() {
        let base = std::env::var("KEASY_MINIO_TEST_URL")
            .expect("set KEASY_MINIO_TEST_URL to a bucket URL, e.g. s3://connector-test/");
        let creds: HashMap<String, String> = [
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_DEFAULT_REGION",
            "AWS_ENDPOINT_URL",
        ]
        .into_iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
        .collect();

        // Unique name per run, under its own prefix, so runs never collide
        // with each other or with real data in the bucket.
        let dir = format!("{}/keasy-connectivity-test", base.trim_end_matches('/'));
        let name = format!("{}.csv", uuid::Uuid::new_v4());
        let url = format!("{dir}/{name}");
        let content = b"id,name\n1,keasy\n".to_vec();

        upload(&url, content.clone(), &creds)
            .await
            .expect("write the object");

        let listed = list_files(&dir, &creds).await.expect("list the prefix");
        assert!(
            listed.iter().any(|f| f.path.ends_with(&name)),
            "written object is listed: {name}"
        );

        let read = download(&url, &creds).await.expect("read the object back");
        assert_eq!(read, content, "read back exactly what was written");

        // Clean up: keasy has no delete, so go through object_store directly.
        let (store, path) = build_store(&url, &creds).expect("store for cleanup");
        match store {
            CloudStore::S3(s) => s.delete(&path).await,
            CloudStore::Azure(s) => s.delete(&path).await,
        }
        .expect("delete the test object");

        eprintln!("✓ MinIO round trip: {url} written, listed, read back and deleted");
    }
}
