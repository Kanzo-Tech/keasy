use rusqlite::params;
use secrecy::ExposeSecret;
use tracing::{error, warn};

use crate::crypto;

use super::Database;

impl Database {
    pub async fn get_secret(&self, key: &str) -> Option<Vec<u8>> {
        let conn = self.conn.lock().await;
        let blob: Vec<u8> = conn
            .query_row(
                "SELECT value FROM secrets WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .ok()?;

        match &self.secret_key {
            Some(sk) => match crypto::decrypt(&blob, sk.expose_secret()) {
                Ok(plain) => Some(plain),
                Err(e) => {
                    error!(key, error = %e, "failed to decrypt secret — check KEASY_SECRET_KEY");
                    None
                }
            },
            None => Some(blob),
        }
    }

    pub async fn set_secret(&self, key: &str, plaintext: &[u8]) {
        let blob = match &self.secret_key {
            Some(sk) => match crypto::encrypt(plaintext, sk.expose_secret()) {
                Ok(enc) => enc,
                Err(e) => {
                    error!(key, error = %e, "failed to encrypt secret");
                    return;
                }
            },
            None => plaintext.to_vec(),
        };

        let conn = self.conn.lock().await;
        if let Err(e) = conn.execute(
            "INSERT INTO secrets (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, blob],
        ) {
            error!(key, error = %e, "failed to persist secret");
        }
    }

    pub async fn delete_secret(&self, key: &str) {
        let conn = self.conn.lock().await;
        let _ = conn.execute("DELETE FROM secrets WHERE key = ?1", [key]);
    }

    /// Try to decrypt one stored secret to verify the key is correct.
    /// Returns `true` if no secrets exist or all checked secrets decrypt OK.
    pub async fn verify_secret_key(&self) -> bool {
        if self.secret_key.is_none() {
            return true;
        }
        let conn = self.conn.lock().await;
        let key: Option<String> = conn
            .query_row("SELECT key FROM secrets LIMIT 1", [], |row| row.get(0))
            .ok();
        let Some(key) = key else {
            return true; // no secrets stored yet
        };
        let blob: Option<Vec<u8>> = conn
            .query_row(
                "SELECT value FROM secrets WHERE key = ?1",
                [&key],
                |row| row.get(0),
            )
            .ok();
        drop(conn);

        let Some(blob) = blob else { return true };
        let sk = self.secret_key.as_ref().unwrap();
        match crypto::decrypt(&blob, sk.expose_secret()) {
            Ok(_) => true,
            Err(e) => {
                warn!(error = %e, "secret key verification failed — stored secrets cannot be decrypted");
                false
            }
        }
    }
}
