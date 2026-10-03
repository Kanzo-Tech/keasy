//! Credentials — `/v1/secrets` on the wire: the keys keasy reaches a store
//! with, shared by the routes, the connections and the bootstrap file. Model
//! calls hold none; they go through the AI gateway.

pub mod persistence;
pub mod probe;
pub mod sealing;

use crate::database::Database;
use crate::domain::{Actor, Credential, ResourceName, SecretSpec, SecretView};
use crate::error::{ErrorCode, Refusal};

/// The credential `name`, unsealed, or 404.
pub async fn named(db: &Database, name: &str) -> Result<Credential, Refusal> {
    persistence::get(&*db.read().await, db.secret_key(), name)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::SecretNotFound, "No such secret"))
}

/// Parse, probe, seal and store a credential, LISTing `probe_url` when one is
/// given.
pub async fn create(
    db: &Database,
    name: &str,
    spec: &SecretSpec,
    probe_url: Option<&str>,
    by: &Actor,
) -> Result<SecretView, Refusal> {
    let name = ResourceName::parse(name).map_err(|e| Refusal::invalid_field("name", e))?;
    let (report, _) = probe::credential(spec, probe_url, &[]).await?;
    if !report.passed() {
        return Err(Refusal::probe_failed(report.failures(), Vec::new()));
    }
    let conn = db.write().await;
    persistence::insert(&conn, db.secret_key(), &name, spec, by, &report)?;
    let stored = persistence::get(&conn, db.secret_key(), name.as_ref())?
        .ok_or_else(|| Refusal::not_found(ErrorCode::SecretNotFound, "No such secret"))?;
    Ok(stored.view(Vec::new()))
}
