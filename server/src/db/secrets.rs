use rusqlite::params;
use tracing::{error, warn};

use crate::crypto;

use super::Database;

impl Database {
    pub async fn get_secret(&self, key: &str) -> Option<Vec<u8>> {
        let (_permit, conn) = self.read().await;
        let blob: Vec<u8> = conn
            .query_row("SELECT value FROM secrets WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .ok()?;

        match crypto::decrypt(&blob, &self.secret_key) {
            Ok(plain) => Some(plain),
            Err(e) => {
                error!(key, error = %e, "failed to decrypt secret — check KEASY_SECRET_KEY");
                None
            }
        }
    }

    pub async fn set_secret(&self, key: &str, plaintext: &[u8]) {
        let blob = match crypto::encrypt(plaintext, &self.secret_key) {
            Ok(enc) => enc,
            Err(e) => {
                error!(key, error = %e, "failed to encrypt secret");
                return;
            }
        };

        let conn = self.write().await;
        if let Err(e) = conn.execute(
            "INSERT INTO secrets (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, blob],
        ) {
            error!(key, error = %e, "failed to persist secret");
        }
    }

    pub async fn delete_secret(&self, key: &str) {
        let conn = self.write().await;
        let _ = conn.execute("DELETE FROM secrets WHERE key = ?1", [key]);
    }

    /// Whether the configured key opens the stored secrets. True when none are
    /// stored yet.
    pub async fn verify_secret_key(&self) -> bool {
        let (_permit, conn) = self.read().await;
        let blob: Option<Vec<u8>> = conn
            .query_row("SELECT value FROM secrets LIMIT 1", [], |row| row.get(0))
            .ok();
        drop(conn);

        let Some(blob) = blob else { return true };
        match crypto::decrypt(&blob, &self.secret_key) {
            Ok(_) => true,
            Err(e) => {
                warn!(error = %e, "secret key verification failed — stored secrets cannot be decrypted");
                false
            }
        }
    }
}
