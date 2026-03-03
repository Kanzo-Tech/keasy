use std::io::{self, Write};
use std::sync::{Arc, Mutex};

use fossil_lang::error::FossilError;
use fossil_lang::runtime::output::{OutputDestination, OutputResolver};

use super::resolver::CloudOutputResolver;

/// Output captured during script execution.
pub struct CapturedOutput {
    pub url: String,
    pub bytes: Vec<u8>,
}

/// Wraps a [`CloudOutputResolver`] to capture output bytes during execution.
///
/// After execution completes, [`take_captured`](Self::take_captured) returns
/// the buffered data so it can be loaded into the graph store without
/// re-downloading from cloud storage.
pub struct TeeOutputResolver {
    inner: Arc<CloudOutputResolver>,
    captured: Mutex<Vec<(String, Arc<Mutex<Vec<u8>>>)>>,
}

impl TeeOutputResolver {
    pub fn new(inner: Arc<CloudOutputResolver>) -> Self {
        Self {
            inner,
            captured: Mutex::new(Vec::new()),
        }
    }

    /// Drain captured outputs after successful execution.
    ///
    /// Moves the byte buffers out instead of cloning when possible (the
    /// `TeeWriter` that held the other `Arc` reference is already dropped
    /// after execution finishes).
    pub fn take_captured(&self) -> Vec<CapturedOutput> {
        let mut entries = self.captured.lock().expect("captured lock poisoned");
        entries
            .drain(..)
            .map(|(url, buf)| {
                let bytes = match Arc::try_unwrap(buf) {
                    Ok(mutex) => mutex.into_inner().expect("buffer lock not poisoned"),
                    Err(arc) => arc.lock().expect("buffer lock poisoned").clone(),
                };
                CapturedOutput { url, bytes }
            })
            .collect()
    }
}

impl OutputResolver for TeeOutputResolver {
    fn resolve_output(&self, destination: &str) -> Result<OutputDestination, FossilError> {
        let inner_dest = self.inner.resolve_output(destination)?;

        let buffer = Arc::new(Mutex::new(Vec::new()));
        self.captured
            .lock()
            .expect("captured lock poisoned")
            .push((destination.to_string(), Arc::clone(&buffer)));

        Ok(OutputDestination {
            writer: Box::new(TeeWriter {
                inner: inner_dest.writer,
                buffer,
            }),
            name: inner_dest.name,
        })
    }

    fn commit(&self) -> Result<(), FossilError> {
        self.inner.commit()
    }

    fn abort(&self) {
        self.inner.abort();
        self.captured.lock().expect("captured lock poisoned").clear();
    }
}

/// Writes to both the underlying cloud writer and an in-memory buffer.
struct TeeWriter {
    inner: Box<dyn Write + Send>,
    buffer: Arc<Mutex<Vec<u8>>>,
}

impl Write for TeeWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.buffer
            .lock()
            .expect("tee buffer lock poisoned")
            .extend_from_slice(&buf[..n]);
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}
