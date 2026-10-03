//! The secrets and connections an instance declares, ensured at boot.
//!
//! `KEASY_BOOTSTRAP_FILE` names a JSON file in the API's own request format:
//! `{"secrets": [CreateSecretRequest…], "connections":
//! [CreateConnectionRequest…]}`. Each secret and
//! connection takes the path the API does — parse, probe, seal — so the
//! declaration and the API cannot drift. Idempotent by name and non-fatal: an
//! existing entry is left as it is, and one that fails is logged and skipped;
//! the next boot tries again.

use serde::Deserialize;
use tracing::{error, info};

use crate::database::Database;
use crate::routes::connections::CreateConnectionRequest;
use crate::routes::secrets::CreateSecretRequest;

/// Who a declared entry was created by: nobody who signs in, so only the
/// owner may change it.
const BY: &str = "bootstrap";

#[derive(Deserialize)]
struct Declared {
    #[serde(default)]
    secrets: Vec<CreateSecretRequest>,
    #[serde(default)]
    connections: Vec<CreateConnectionRequest>,
}

pub async fn ensure_declared(db: &Database, path: &str) {
    let declared = match std::fs::read(path)
        .map_err(|e| e.to_string())
        .and_then(|bytes| serde_json::from_slice::<Declared>(&bytes).map_err(|e| e.to_string()))
    {
        Ok(declared) => declared,
        Err(e) => return error!(%path, error = %e, "bootstrap file: skipped"),
    };

    for request in declared.secrets {
        let name = request.name.clone();
        match crate::credentials::named(db, &name).await {
            Ok(_) => continue,
            Err(refusal) if refusal.status == axum::http::StatusCode::NOT_FOUND => {}
            Err(e) => {
                error!(%name, error = ?e, "declared secret: skipped");
                continue;
            }
        }
        match crate::credentials::create(
            db,
            &request.name,
            &request.spec,
            request.probe_url.as_deref(),
            BY,
        )
        .await
        {
            Ok(_) => info!(%name, "declared secret ready"),
            Err(e) => error!(%name, error = ?e, "declared secret: rejected"),
        }
    }

    for request in declared.connections {
        let name = request.name.clone();
        match crate::connections::named(db, &name).await {
            Ok(_) => continue,
            Err(refusal) if refusal.status == axum::http::StatusCode::NOT_FOUND => {}
            Err(e) => {
                error!(%name, error = ?e, "declared connection: skipped");
                continue;
            }
        }
        match crate::connections::create(db, request.name, request.secret, request.target, BY).await
        {
            Ok(_) => info!(%name, "declared connection ready"),
            Err(e) => error!(%name, error = ?e, "declared connection: rejected"),
        }
    }
}
