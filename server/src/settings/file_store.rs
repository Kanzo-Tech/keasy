use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use secrecy::{ExposeSecret, SecretString};
use serde::{de::DeserializeOwned, Serialize};
use tracing::warn;

use super::crypto;

#[derive(Clone)]
pub struct FileStore<T> {
    inner: Arc<RwLock<T>>,
    path: PathBuf,
    secret: Option<SecretString>,
}

impl<T: Serialize + DeserializeOwned + Default + Clone> FileStore<T> {
    pub fn new(path: PathBuf, secret: Option<SecretString>) -> Self {
        let loaded = Self::load_from_disk(&path, secret.as_ref()).unwrap_or_default();
        Self {
            inner: Arc::new(RwLock::new(loaded)),
            path,
            secret,
        }
    }

    pub fn read(&self) -> T {
        self.inner.read().expect("lock poisoned").clone()
    }

    pub fn write(&self, value: T) {
        let mut guard = self.inner.write().expect("lock poisoned");
        *guard = value;
        self.persist(&guard);
    }

    pub fn update(&self, f: impl FnOnce(&mut T)) {
        let mut guard = self.inner.write().expect("lock poisoned");
        f(&mut guard);
        self.persist(&guard);
    }

    fn persist(&self, value: &T) {
        match &self.secret {
            None => {
                if let Ok(json) = serde_json::to_string_pretty(value) {
                    if let Err(e) = atomic_write(&self.path, json.as_bytes()) {
                        warn!(path = %self.path.display(), "failed to write store: {e}");
                    }
                }
            }
            Some(key) => {
                let Ok(json) = serde_json::to_vec(value) else { return };
                match crypto::encrypt(&json, key.expose_secret()) {
                    Ok(blob) => {
                        if let Err(e) = atomic_write(&self.path, &blob) {
                            warn!(path = %self.path.display(), "failed to write encrypted store: {e}");
                        }
                    }
                    Err(e) => warn!(path = %self.path.display(), "encryption failed: {e}"),
                }
            }
        }
    }

    fn load_from_disk(path: &Path, secret: Option<&SecretString>) -> Option<T> {
        let data = std::fs::read(path).ok()?;
        match secret {
            None => serde_json::from_slice(&data).ok(),
            Some(key) => {
                let json = crypto::decrypt(&data, key.expose_secret()).ok()?;
                serde_json::from_slice(&json).ok()
            }
        }
    }
}

fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(data)?;
    file.sync_all()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    drop(file);
    std::fs::rename(&tmp, path)?;
    Ok(())
}
