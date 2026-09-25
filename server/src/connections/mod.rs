//! Connections: a credential put to use — a storage prefix or a model.

pub mod locator;
pub mod persistence;

use crate::database::Database;
use crate::domain::{
    ConnectionTarget, ConnectionView, Credential, CredentialSpecInput, ModelCredentialInput,
    ResourceName, StorageCredentialInput, StorageUrl,
};
use crate::error::Refusal;

/// The connection `name`, or 404.
pub async fn named(db: &Database, name: &str) -> Result<ConnectionView, Refusal> {
    persistence::get(&*db.read().await, name)?.ok_or_else(|| Refusal::not_found("Connection"))
}

/// The credential `connection` points at, checked for its purpose and — for a
/// storage connection — for reaching the URL's store.
fn fits(
    credential: Option<Credential>,
    connection: &ConnectionView,
) -> Result<Credential, Refusal> {
    let credential = credential.ok_or_else(|| {
        Refusal::invalid(format!(
            "there is no credential named {:?}",
            connection.credential
        ))
    })?;
    if credential.spec.purpose() != connection.target.purpose() {
        return Err(Refusal::invalid(format!(
            "{:?} is a {} credential; a {} connection needs a {} one",
            credential.name,
            credential.spec.purpose().as_ref(),
            connection.target.purpose().as_ref(),
            connection.target.purpose().as_ref(),
        )));
    }
    if let (ConnectionTarget::Storage(target), CredentialSpecInput::Storage(spec)) =
        (&connection.target, &credential.spec)
    {
        let url = StorageUrl::parse(&target.url).map_err(Refusal::invalid)?;
        crate::storage_client::store(spec, &url).map_err(Refusal::invalid)?;
    }
    Ok(credential)
}

/// Check, probe and store `connection` as `name`'s new state (a new one when
/// `name` is `None`). A connection that does not validate is not stored.
pub async fn save(
    db: &Database,
    name: Option<&str>,
    mut connection: ConnectionView,
    by: &str,
) -> Result<ConnectionView, Refusal> {
    ResourceName::parse(&connection.name).map_err(Refusal::invalid)?;
    let credential = crate::credentials::persistence::get(
        &*db.read().await,
        db.secret_key(),
        &connection.credential,
    )?;
    let credential = fits(credential, &connection)?;
    let report = crate::credentials::probe::connection(&credential.spec, &connection.target).await;
    if !report.passed() {
        return Err(Refusal::probe_failed(report.failures(), Vec::new()));
    }
    connection.validation = Some(report);

    let conn = db.write().await;
    match name {
        None => persistence::insert(&conn, &connection, by)?,
        Some(name) => persistence::update(&conn, name, &connection, by)?,
    }
    persistence::get(&conn, &connection.name)?.ok_or_else(|| Refusal::not_found("Connection"))
}

pub async fn create(
    db: &Database,
    name: String,
    credential: String,
    target: ConnectionTarget,
    by: &str,
) -> Result<ConnectionView, Refusal> {
    let connection = ConnectionView {
        name,
        credential,
        target,
        created_by: by.into(),
        created_at: String::new(),
        updated_by: by.into(),
        updated_at: String::new(),
        validation: None,
    };
    save(db, None, connection, by).await
}

/// A storage connection's URL and the credential it signs with.
pub async fn storage(
    db: &Database,
    connection: &ConnectionView,
) -> Result<(StorageUrl, StorageCredentialInput), Refusal> {
    let target = connection.target.storage().ok_or_else(|| {
        Refusal::invalid(format!("{:?} is not a storage connection", connection.name))
    })?;
    let url = StorageUrl::parse(&target.url).map_err(Refusal::invalid)?;
    match crate::credentials::named(db, &connection.credential)
        .await?
        .spec
    {
        CredentialSpecInput::Storage(spec) => Ok((url, spec)),
        CredentialSpecInput::Model(_) => Err(Refusal::invalid("not a storage credential")),
    }
}

/// A model connection's target and the key it calls with.
pub async fn model(
    db: &Database,
    connection: &ConnectionView,
) -> Result<(crate::domain::ModelTarget, ModelCredentialInput), Refusal> {
    let ConnectionTarget::Model(target) = &connection.target else {
        return Err(Refusal::invalid(format!(
            "{:?} is not a model connection",
            connection.name
        )));
    };
    match crate::credentials::named(db, &connection.credential)
        .await?
        .spec
    {
        CredentialSpecInput::Model(spec) => Ok((target.clone(), spec)),
        CredentialSpecInput::Storage(_) => Err(Refusal::invalid("not a model credential")),
    }
}
