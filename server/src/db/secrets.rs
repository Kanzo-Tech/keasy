use base64::Engine;
use rusqlite::params;
use secrecy::{ExposeSecret, SecretString};
use tracing::{error, warn};

use crate::crypto;

use super::Database;

const SESSION_SECRET_KEY: &str = "session_secret";

impl Database {
    /// The session cookie signing key, persisted (encrypted by the secret key) in the
    /// `secrets` table so it survives restarts and rides along with keasy.db's
    /// replication. Generated once on first boot — callers use this instead of an
    /// injected KEASY_SESSION_SECRET when none is provided.
    pub async fn get_or_create_session_secret(&self) -> SecretString {
        if let Some(bytes) = self.get_secret(SESSION_SECRET_KEY).await
            && let Ok(existing) = String::from_utf8(bytes)
        {
            return SecretString::from(existing);
        }
        let mut raw = [0u8; 64];
        getrandom::getrandom(&mut raw).expect("OS RNG unavailable");
        let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
        self.set_secret(SESSION_SECRET_KEY, encoded.as_bytes())
            .await;
        SecretString::from(encoded)
    }

    pub async fn get_secret(&self, key: &str) -> Option<Vec<u8>> {
        let (_permit, conn) = self.read().await;
        let blob: Vec<u8> = conn
            .query_row("SELECT value FROM secrets WHERE key = ?1", [key], |row| {
                row.get(0)
            })
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

    /// Try to decrypt one stored secret to verify the key is correct.
    /// Returns `true` if no secrets exist or all checked secrets decrypt OK.
    pub async fn verify_secret_key(&self) -> bool {
        if self.secret_key.is_none() {
            return true;
        }
        let (_permit, conn) = self.read().await;
        let key: Option<String> = conn
            .query_row("SELECT key FROM secrets LIMIT 1", [], |row| row.get(0))
            .ok();
        let Some(key) = key else {
            return true; // no secrets stored yet
        };
        let blob: Option<Vec<u8>> = conn
            .query_row("SELECT value FROM secrets WHERE key = ?1", [&key], |row| {
                row.get(0)
            })
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
