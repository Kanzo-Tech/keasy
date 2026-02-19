use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;

use fossil_lang::error::FossilError;
use fossil_lang::runtime::output::{OutputDestination, OutputResolver};
use object_store::WriteMultipart;

/// Resolves output destinations for the server.
///
/// Cloud paths (`s3://`, `gs://`, `az://`, `abfss://`) get a streaming writer
/// that uploads directly via multipart upload — zero disk usage.
///
/// Non-cloud (local) paths are rejected — in a server context all output
/// must go to cloud storage.
///
/// Credentials are passed as a snapshot map (env_var_name → value) rather than
/// relying on process-wide environment variables, avoiding unsafe env mutation
/// and concurrency issues.
pub struct CloudOutputResolver {
    runtime_handle: tokio::runtime::Handle,
    creds: Arc<HashMap<String, String>>,
}

impl CloudOutputResolver {
    pub fn new(
        runtime_handle: tokio::runtime::Handle,
        creds: HashMap<String, String>,
    ) -> Self {
        Self {
            runtime_handle,
            creds: Arc::new(creds),
        }
    }
}

impl OutputResolver for CloudOutputResolver {
    fn resolve_output(&self, destination: &str) -> Result<OutputDestination, FossilError> {
        if !is_cloud_path(destination) {
            return Err(FossilError::evaluation(
                format!(
                    "Server mode requires cloud output paths (s3://, gs://, az://, abfss://), got '{}'",
                    destination
                ),
                fossil_lang::ast::Loc::generated(),
            ));
        }

        let writer = CloudStreamWriter::new(
            destination,
            self.runtime_handle.clone(),
            &self.creds,
        )
        .map_err(|e| {
            FossilError::evaluation(
                format!(
                    "Failed to create cloud writer for '{}': {}",
                    destination, e
                ),
                fossil_lang::ast::Loc::generated(),
            )
        })?;

        Ok(OutputDestination {
            writer: Box::new(writer),
            name: destination.to_string(),
        })
    }
}

/// Sync `Write` adapter over `object_store::WriteMultipart`.
///
/// `WriteMultipart::write()` is sync and buffers data internally, spawning
/// background tasks to upload 5MB parts in parallel. `finish()` is async
/// and called via `Handle::block_on` when the writer is flushed/dropped.
struct CloudStreamWriter {
    multipart: Option<WriteMultipart>,
    handle: tokio::runtime::Handle,
}

impl CloudStreamWriter {
    fn new(
        url: &str,
        handle: tokio::runtime::Handle,
        creds: &HashMap<String, String>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let (store, path) = super::build_store(url, creds)?;
        let upload = handle.block_on(store.put_multipart(&path))?;
        let multipart = WriteMultipart::new(upload);
        Ok(Self {
            multipart: Some(multipart),
            handle,
        })
    }

    fn finish_upload(&mut self) -> std::io::Result<()> {
        if let Some(multipart) = self.multipart.take() {
            self.handle
                .block_on(multipart.finish())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        }
        Ok(())
    }
}

impl Write for CloudStreamWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Some(ref mut mp) = self.multipart {
            mp.write(buf);
            Ok(buf.len())
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Writer already finished",
            ))
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.finish_upload()
    }
}

impl Drop for CloudStreamWriter {
    fn drop(&mut self) {
        if self.multipart.is_some() {
            let _ = self.finish_upload();
        }
    }
}

fn is_cloud_path(path: &str) -> bool {
    path.starts_with("s3://")
        || path.starts_with("gs://")
        || path.starts_with("az://")
        || path.starts_with("abfss://")
}
