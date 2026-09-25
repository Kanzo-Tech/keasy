//! Credentials: the capability every consumer shares — routes, connections,
//! the bootstrap file and the LLM proxy.

pub mod persistence;
pub mod probe;
pub mod sealing;

use crate::api::credentials::{CreateCredentialRequest, CredentialView};

use crate::database::Database;
use crate::domain::ResourceName;
use crate::error::Refusal;
use persistence::Credential;

/// The credential `name`, unsealed, or 404.
pub async fn named(db: &Database, name: &str) -> Result<Credential, Refusal> {
    persistence::get(&*db.read().await, db.secret_key(), name)?
        .ok_or_else(|| Refusal::not_found("Credential"))
}

/// Parse, probe, seal and store a credential. A model credential must list
/// its models; a storage credential must list `probe_url` when one is given.
pub async fn create(
    db: &Database,
    request: CreateCredentialRequest,
    by: &str,
) -> Result<CredentialView, Refusal> {
    let name = ResourceName::parse(&request.name).map_err(Refusal::invalid)?;
    let (report, _) = probe::credential(&request.spec, request.probe_url.as_deref(), &[]).await;
    if !report.passed() {
        return Err(Refusal::probe_failed(report.failures(), Vec::new()));
    }
    let conn = db.write().await;
    persistence::insert(&conn, db.secret_key(), &name, &request.spec, by, &report)?;
    let stored = persistence::get(&conn, db.secret_key(), name.as_ref())?
        .ok_or_else(|| Refusal::not_found("Credential"))?;
    Ok(stored.view(Vec::new()))
}
