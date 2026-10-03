//! Credentials: the capability every consumer shares — routes, connections,
//! the bootstrap file and the LLM proxy.

pub mod persistence;
pub mod probe;
pub mod sealing;

use sealing::SecretKey;

use crate::configuration::DatabaseSettings;
use crate::database::Database;
use crate::domain::{Credential, ResourceName, SecretView, StorageCredentialInput};
use crate::error::{ErrorCode, Refusal};

/// The credential `name`, unsealed, or 404.
pub async fn named(db: &Database, name: &str) -> Result<Credential, Refusal> {
    persistence::get(&*db.read().await, db.secret_key(), name)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::SecretNotFound, "No such credential"))
}

/// Parse, probe, seal and store a credential. A model credential must list
/// its models; a storage credential must list `probe_url` when one is given.
pub async fn create(
    db: &Database,
    name: &str,
    spec: &StorageCredentialInput,
    probe_url: Option<&str>,
    by: &str,
) -> Result<SecretView, Refusal> {
    let name = ResourceName::parse(name).map_err(|e| Refusal::invalid_field("name", e))?;
    let (report, _) = probe::credential(spec, probe_url, &[]).await?;
    if !report.passed() {
        return Err(Refusal::probe_failed(report.failures(), Vec::new()));
    }
    let conn = db.write().await;
    persistence::insert(&conn, db.secret_key(), &name, spec, by, &report)?;
    let stored = persistence::get(&conn, db.secret_key(), name.as_ref())?
        .ok_or_else(|| Refusal::not_found(ErrorCode::SecretNotFound, "No such credential"))?;
    Ok(stored.view(Vec::new()))
}

/// Seal every stored credential again under `new`, reading them with the
/// configured key. One transaction: all move or none does.
pub fn rekey(database: &DatabaseSettings, new: &SecretKey) -> Result<usize, String> {
    let path = database.path();
    let mut conn = rusqlite::Connection::open(&path)
        .map_err(|e| format!("failed to open {}: {e}", path.display()))?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
        .map_err(|e| e.to_string())?;
    crate::database::apply_schema(&conn)?;
    persistence::rekey(&mut conn, &database.secret_key, new).map_err(|e| e.to_string())
}
