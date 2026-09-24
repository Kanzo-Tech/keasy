use rusqlite::{OptionalExtension, params};

use crate::crypto;

use super::{Database, DbError, DbResult};

impl Database {
    pub async fn get_secret(&self, key: &str) -> DbResult<Option<Vec<u8>>> {
        let blob: Option<Vec<u8>> = self
            .read()
            .await
            .query_row("SELECT value FROM secrets WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        blob.map(|blob| crypto::decrypt(&blob, &self.secret_key).map_err(DbError::Secret))
            .transpose()
    }

    pub async fn set_secret(&self, key: &str, plaintext: &[u8]) -> DbResult<()> {
        let blob = crypto::encrypt(plaintext, &self.secret_key).map_err(DbError::Secret)?;
        self.write().await.execute(
            "INSERT INTO secrets (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, blob],
        )?;
        Ok(())
    }

    pub async fn delete_secret(&self, key: &str) -> DbResult<()> {
        self.write()
            .await
            .execute("DELETE FROM secrets WHERE key = ?1", [key])?;
        Ok(())
    }

    /// Whether the configured key opens the stored secrets. True when none are
    /// stored yet.
    pub async fn verify_secret_key(&self) -> DbResult<bool> {
        let blob: Option<Vec<u8>> = self
            .read()
            .await
            .query_row("SELECT value FROM secrets LIMIT 1", [], |row| row.get(0))
            .optional()?;
        Ok(blob.is_none_or(|blob| crypto::decrypt(&blob, &self.secret_key).is_ok()))
    }
}
