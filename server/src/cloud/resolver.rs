use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use fossil_lang::error::FossilError;
use fossil_lang::runtime::output::{OutputDestination, OutputResolver};
use object_store::WriteMultipart;

pub struct CloudOutputResolver {
    runtime_handle: tokio::runtime::Handle,
    creds: Arc<HashMap<String, String>>,
    writers: Mutex<Vec<Arc<Mutex<Option<WriteMultipart>>>>>,
}

impl CloudOutputResolver {
    pub fn new(
        runtime_handle: tokio::runtime::Handle,
        creds: HashMap<String, String>,
    ) -> Self {
        Self {
            runtime_handle,
            creds: Arc::new(creds),
            writers: Mutex::new(Vec::new()),
        }
    }
}

impl OutputResolver for CloudOutputResolver {
    fn resolve_output(&self, destination: &str) -> Result<OutputDestination, FossilError> {
        if !super::is_cloud_url(destination) {
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

        self.writers
            .lock()
            .expect("writers lock poisoned")
            .push(Arc::clone(&writer.multipart));

        Ok(OutputDestination {
            writer: Box::new(writer),
            name: destination.to_string(),
        })
    }

    fn commit(&self) -> Result<(), FossilError> {
        let writers = self.writers.lock().expect("writers lock poisoned");
        for mp_ref in writers.iter() {
            let mut guard = mp_ref.lock().expect("multipart lock poisoned");
            if let Some(multipart) = guard.take() {
                self.runtime_handle
                    .block_on(multipart.finish())
                    .map_err(|e| {
                        FossilError::evaluation(
                            format!("Failed to commit upload: {}", e),
                            fossil_lang::ast::Loc::generated(),
                        )
                    })?;
            }
        }
        Ok(())
    }

    fn abort(&self) {
        let writers = self.writers.lock().expect("writers lock poisoned");
        for mp_ref in writers.iter() {
            let mut guard = mp_ref.lock().expect("multipart lock poisoned");
            if let Some(multipart) = guard.take() {
                let _ = self.runtime_handle.block_on(multipart.abort());
            }
        }
    }
}

struct CloudStreamWriter {
    multipart: Arc<Mutex<Option<WriteMultipart>>>,
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
            multipart: Arc::new(Mutex::new(Some(multipart))),
        })
    }

}

impl Write for CloudStreamWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut guard = self.multipart.lock().expect("multipart lock poisoned");
        if let Some(ref mut mp) = *guard {
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
        Ok(())
    }
}

impl Drop for CloudStreamWriter {
    fn drop(&mut self) {
        // No-op: commit is explicit via OutputResolver::commit().
        // Abandoned multipart uploads are cleaned up by cloud provider lifecycle rules.
    }
}

