//! A source connection declared by the environment, ensured at boot.
//!
//! `KEASY_BOOTSTRAP_CONNECTION_URL` and `_NAME` name a store this instance
//! should already know about the first time anyone opens it — in dev, the MinIO
//! bucket the compose overlay seeds. The credentials are read from the env vars
//! the provider schema already declares for its own fields
//! (`AWS_ACCESS_KEY_ID`, `AZURE_STORAGE_ACCOUNT_NAME`, …), so declaring a
//! connection invents no second vocabulary, and they travel the ordinary
//! `create_cloud_account` path — split into fields and secrets by the schema,
//! and encrypted.
//!
//! Idempotent and non-fatal: a connection (or account) of that name is left
//! alone, and anything that goes wrong is logged and skipped — the instance
//! serves without it, and the next boot tries again.

use std::collections::HashMap;

use tracing::{error, info};

use crate::cloud::models::CreateCloudAccountRequest;
use crate::cloud::reader;
use crate::db::Database;

use super::models::{ConnectionKind, CreateConnectionRequest, Direction, LocationType};

pub async fn ensure_declared_connection(db: &Database) {
    let (Some(name), Some(url)) = (
        env_nonblank("KEASY_BOOTSTRAP_CONNECTION_NAME"),
        env_nonblank("KEASY_BOOTSTRAP_CONNECTION_URL"),
    ) else {
        return;
    };

    if db.get_connection_by_name(&name).await.is_some() {
        return;
    }

    let provider = match crate::cloud::parse_cloud_url(&url) {
        Ok((_, _, provider)) => provider,
        Err(e) => {
            error!(%url, error = %e, "declared connection: not a usable cloud URL");
            return;
        }
    };

    let auth_method = env_nonblank("KEASY_BOOTSTRAP_CONNECTION_AUTH_METHOD");
    let mut fields = HashMap::new();
    for field in provider.active_fields(auth_method.as_deref()) {
        if let Some(env_var) = field.env_var
            && let Some(value) = env_nonblank(env_var)
        {
            fields.insert(field.name.to_string(), value);
        }
    }

    let account_id = match db
        .list_cloud_accounts()
        .await
        .into_iter()
        .find(|a| a.name == name)
    {
        Some(existing) => existing.id,
        None => {
            let request = CreateCloudAccountRequest {
                name: name.clone(),
                provider_id: provider.id.to_string(),
                auth_method,
                fields,
            };
            match db.create_cloud_account(request).await {
                Ok(account) => account.id,
                Err(e) => {
                    error!(%name, error = %e, "declared connection: cloud account rejected");
                    return;
                }
            }
        }
    };

    // The same proof of access the API demands before it accepts a connection
    // typed in by hand: a store nobody can read is not a connection.
    let creds = db
        .build_storage_config(std::slice::from_ref(&account_id))
        .await;
    if let Err(e) = reader::list_files(&url, &creds).await {
        error!(%name, %url, error = %e, "declared connection: store unreachable");
        return;
    }

    let request = CreateConnectionRequest {
        name: name.clone(),
        kind: ConnectionKind::Data,
        location_type: LocationType::Cloud,
        direction: Direction::Source,
        cloud_account_id: Some(account_id),
        url: url.clone(),
    };
    match db.create_connection(request).await {
        Ok(_) => info!(%name, %url, "declared connection ready"),
        Err(e) => error!(%name, error = %e, "declared connection: rejected"),
    }
}

fn env_nonblank(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}
