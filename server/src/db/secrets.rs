use diesel::prelude::*;
use secrecy::ExposeSecret;
use tracing::{error, warn};

use crate::crypto;
use super::Repos;
use super::diesel_schema::secrets::dsl;

impl Repos {
    pub async fn get_secret(&self, key: &str) -> Option<Vec<u8>> {
        let key = key.to_string();
        let blob: Vec<u8> = self.diesel_pool.get().await.ok()?
            .interact(move |conn| {
                dsl::secrets
                    .filter(dsl::key.eq(&key))
                    .select(dsl::value)
                    .first::<Vec<u8>>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()??;

        match &self.secret_key {
            Some(sk) => match crypto::decrypt(&blob, sk.expose_secret()) {
                Ok(plain) => Some(plain),
                Err(e) => {
                    error!(error = %e, "failed to decrypt secret — check KEASY_SECRET_KEY");
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
                    error!(error = %e, "failed to encrypt secret");
                    return;
                }
            },
            None => plaintext.to_vec(),
        };

        let key = key.to_string();
        let Ok(pool_conn) = self.diesel_pool.get().await else { return };
        let _ = pool_conn.interact(move |conn| {
            diesel::insert_into(dsl::secrets)
                .values((dsl::key.eq(&key), dsl::value.eq(blob.as_slice())))
                .on_conflict(dsl::key)
                .do_update()
                .set(dsl::value.eq(blob.as_slice()))
                .execute(conn)
        }).await;
    }

    pub async fn delete_secret(&self, key: &str) {
        let key = key.to_string();
        let Ok(pool_conn) = self.diesel_pool.get().await else { return };
        let _ = pool_conn.interact(move |conn| {
            diesel::delete(dsl::secrets.filter(dsl::key.eq(&key)))
                .execute(conn)
        }).await;
    }

    pub async fn verify_secret_key(&self) -> bool {
        if self.secret_key.is_none() {
            return true;
        }
        let Ok(pool_conn) = self.diesel_pool.get().await else { return true };
        let result = pool_conn.interact(|conn| {
            dsl::secrets
                .select((dsl::key, dsl::value))
                .first::<(String, Vec<u8>)>(conn)
                .optional()
        }).await;

        let Ok(Ok(Some((_key, blob)))) = result else { return true };

        let sk = self.secret_key.as_ref().unwrap();
        match crypto::decrypt(&blob, sk.expose_secret()) {
            Ok(_) => true,
            Err(e) => {
                warn!(error = %e, "secret key verification failed");
                false
            }
        }
    }
}
