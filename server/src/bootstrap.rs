//! The secrets, connections and jobs an instance declares, ensured at boot.
//!
//! `KEASY_BOOTSTRAP_FILE` names a JSON file in the API's own request format:
//! `{"secrets": [CreateSecretRequest…], "connections":
//! [CreateConnectionRequest…], "jobs": [DeclaredJob…]}`. Each secret and
//! connection takes the path the API does — parse, probe, seal — so the
//! declaration and the API cannot drift. Idempotent by name and non-fatal: an
//! existing entry is left as it is, and one that fails is logged and skipped;
//! the next boot tries again.

use std::path::Path;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tracing::{error, info};

use crate::database::Database;
use crate::domain::{Job, JobFolder};
use crate::routes::connections::CreateConnectionRequest;
use crate::routes::secrets::CreateSecretRequest;

/// Who a declared entry was created by: nobody who signs in, so only the
/// owner may change it.
const BY: &str = "bootstrap";

/// A job the instance ships ready to run, for a person it names by email.
///
/// A job is its creator's alone and the creator is a Keycloak `sub`, which
/// does not exist until the person first signs in; so the job is held for the
/// address ([`declared_for`]) and the member whose verified email it is takes
/// it over the first time they list their jobs (`jobs::claim_declared`). It is
/// declared a draft: a job waiting to run is swept as abandoned once its lease
/// lapses, and nobody ran this one; the member opens it in the studio and
/// creates it when they mean to.
#[derive(Deserialize)]
struct DeclaredJob {
    name: String,
    /// The email the realm declares the member by.
    owner: String,
    sink_connection: String,
    /// The folder under the sink the output lands in, spelled as on create.
    folder: String,
    /// The program, relative to the bootstrap file.
    script_file: String,
}

#[derive(Deserialize)]
struct Declared {
    #[serde(default)]
    secrets: Vec<CreateSecretRequest>,
    #[serde(default)]
    connections: Vec<CreateConnectionRequest>,
    #[serde(default)]
    jobs: Vec<DeclaredJob>,
}

/// Who holds a job declared for `email` until that person signs in.
pub fn declared_for(email: &str) -> String {
    format!("{BY}:{email}")
}

/// A declared job's id: the same on every boot, so "already there" is a lookup
/// that survives the job changing hands. A name-based UUIDv8 over SHA-256, the
/// construction RFC 9562 §B.2 gives as its example.
fn declared_job_id(name: &str) -> String {
    let digest = Sha256::digest(format!("keasy:bootstrap:job:{name}"));
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    uuid::Builder::from_custom_bytes(bytes)
        .into_uuid()
        .to_string()
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

    let dir = Path::new(path).parent().unwrap_or(Path::new("."));
    for declared in declared.jobs {
        let name = declared.name.clone();
        match ensure_job(db, dir, declared).await {
            Ok(true) => info!(%name, "declared job ready"),
            Ok(false) => {}
            Err(e) => error!(%name, error = %e, "declared job: rejected"),
        }
    }
}

/// Insert the declared job unless it is already there. `Ok(false)` when it is.
async fn ensure_job(db: &Database, dir: &Path, declared: DeclaredJob) -> Result<bool, String> {
    use crate::jobs::persistence;

    let id = declared_job_id(&declared.name);
    if persistence::get(&*db.read().await, &id)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Ok(false);
    }
    let is_sink =
        crate::connections::persistence::get(&*db.read().await, &declared.sink_connection)
            .map_err(|e| e.to_string())?
            .is_some_and(|c| c.target.is_sink());
    if !is_sink {
        return Err(format!(
            "`{}` is not a sink connection",
            declared.sink_connection
        ));
    }
    let folder = JobFolder::parse(&declared.folder)?;
    let script_path = dir.join(&declared.script_file);
    let script = std::fs::read_to_string(&script_path)
        .map_err(|e| format!("{}: {e}", script_path.display()))?;

    let mut job = Job::new(
        Some(declared.name),
        declared.sink_connection,
        Some(folder),
        script,
        declared_for(&declared.owner),
    );
    job.id = id;
    persistence::insert(&*db.write().await, &job).map_err(|e| e.to_string())?;
    Ok(true)
}
