//! Connections: a credential put to use — a storage prefix.

pub mod persistence;

use crate::database::Database;
use crate::domain::{
    ConnectionView, Credential, ResourceName, StorageCredentialInput, StorageLocation,
    StorageTarget,
};
use crate::error::{ErrorCode, Refusal};

/// The connection `name`, or 404.
pub async fn named(db: &Database, name: &str) -> Result<ConnectionView, Refusal> {
    persistence::get(&*db.read().await, name)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::ConnectionNotFound, "No such connection"))
}

/// The credential `connection` points at, checked for reaching the URL's
/// store. The URL is rewritten in its canonical form, which is the form every
/// reader expands.
fn fits(
    credential: Option<Credential>,
    connection: &mut ConnectionView,
) -> Result<Credential, Refusal> {
    let credential = credential.ok_or_else(|| {
        Refusal::invalid(format!(
            "there is no credential named {:?}",
            connection.credential
        ))
    })?;
    let location = StorageLocation::parse(&connection.target.url)
        .and_then(|l| l.within(&credential.spec))
        .map_err(Refusal::invalid)?;
    crate::storage_client::store(&credential.spec, &location).map_err(Refusal::invalid)?;
    connection.target.url = location.to_string();
    Ok(credential)
}

/// Refuse a storage location that shares a prefix with another connection's,
/// the sink's included — Unity Catalog's rule that external locations never
/// overlap. With it, every object has at most one connection over it, and a
/// source can never reach into the sink.
async fn disjoint(
    db: &Database,
    connection: &ConnectionView,
    name: Option<&str>,
) -> Result<(), Refusal> {
    let (location, _) = storage(db, connection).await?;
    let others = persistence::list(&*db.read().await)?;
    let mut overlapping = Vec::new();
    for other in others.iter().filter(|o| Some(o.name.as_str()) != name) {
        let (theirs, _) = storage(db, other).await?;
        if theirs.overlaps(&location) {
            overlapping.push(other.name.clone());
        }
    }
    if overlapping.is_empty() {
        return Ok(());
    }
    Err(Refusal::overlaps(
        format!(
            "{location} overlaps the location of {}: a prefix belongs to one connection",
            overlapping.join(", ")
        ),
        overlapping,
    ))
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
    let credential = fits(credential, &mut connection)?;
    disjoint(db, &connection, name).await?;
    let report = crate::credentials::probe::connection(&credential.spec, &connection.target)
        .await
        .map_err(|e| e.refusal(ErrorCode::ProbeFailed))?;
    if !report.passed() {
        return Err(Refusal::probe_failed(report.failures(), Vec::new()));
    }
    connection.validation = Some(report);

    let conn = db.write().await;
    match name {
        None => persistence::insert(&conn, &connection, by)?,
        Some(name) => persistence::update(&conn, name, &connection, by)?,
    }
    persistence::get(&conn, &connection.name)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::ConnectionNotFound, "No such connection"))
}

pub async fn create(
    db: &Database,
    name: String,
    credential: String,
    target: StorageTarget,
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

/// A storage connection's location, as its credential reaches it, and that credential.
pub async fn storage(
    db: &Database,
    connection: &ConnectionView,
) -> Result<(StorageLocation, StorageCredentialInput), Refusal> {
    let location = StorageLocation::parse(&connection.target.url).map_err(Refusal::invalid)?;
    let spec = crate::credentials::named(db, &connection.credential)
        .await?
        .spec;
    let location = location.within(&spec).map_err(Refusal::invalid)?;
    Ok((location, spec))
}
