//! Connections: a secret put to use — a storage prefix.

pub mod persistence;

use crate::credentials::sealing::SecretKey;
use crate::database::Database;
use crate::domain::{
    Actor, ConnectionView, Credential, Direction, Provenance, ResourceName, SecretSpec,
    StorageLocation, StorageTarget,
};
use crate::error::{ErrorCode, Refusal};
use crate::storage_client::Endpoints;

/// The connection `name`, or 404.
pub async fn named(db: &Database, name: &str) -> Result<ConnectionView, Refusal> {
    persistence::get(&*db.read().await, name)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::ConnectionNotFound, "No such connection"))
}

/// The secret `connection` points at, checked for reaching the URL's
/// store. The URL is rewritten in its canonical form, which is the form every
/// reader expands.
fn fits(
    credential: Option<Credential>,
    connection: &mut ConnectionView,
    endpoints: &Endpoints,
) -> Result<Credential, Refusal> {
    let credential = credential.ok_or_else(|| {
        Refusal::invalid(format!("there is no secret named {:?}", connection.secret))
    })?;
    let location = StorageLocation::parse(&connection.target.url)
        .and_then(|l| l.within(&credential.spec))
        .map_err(Refusal::invalid)?;
    crate::storage_client::store(&credential.spec, &location, endpoints)
        .map_err(Refusal::invalid)?;
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
    let conn = db.read().await;
    let (location, _) = storage(&conn, db.secret_key(), connection)?;
    let mut overlapping = Vec::new();
    for other in persistence::list(&conn)?
        .iter()
        .filter(|o| Some(o.name.as_str()) != name)
    {
        let (theirs, _) = storage(&conn, db.secret_key(), other)?;
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
    by: &Actor,
    endpoints: &Endpoints,
) -> Result<ConnectionView, Refusal> {
    ResourceName::parse(&connection.name).map_err(|e| Refusal::invalid_field("name", e))?;
    let credential = crate::credentials::persistence::get(
        &*db.read().await,
        db.secret_key(),
        &connection.secret,
    )?;
    let credential = fits(credential, &mut connection, endpoints)?;
    disjoint(db, &connection, name).await?;
    let report =
        crate::credentials::probe::connection(&credential.spec, &connection.target, endpoints)
            .await?;
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
    secret: String,
    target: StorageTarget,
    by: &Actor,
    endpoints: &Endpoints,
) -> Result<ConnectionView, Refusal> {
    let connection = ConnectionView {
        name,
        secret,
        target,
        provenance: Provenance::created(by.clone()),
        validation: None,
        can_modify: false,
    };
    save(db, None, connection, by, endpoints).await
}

/// A storage connection's location, as its secret reaches it, and that secret.
pub fn storage(
    conn: &rusqlite::Connection,
    key: &SecretKey,
    connection: &ConnectionView,
) -> Result<(StorageLocation, SecretSpec), Refusal> {
    let location = StorageLocation::parse(&connection.target.url).map_err(Refusal::invalid)?;
    let spec = crate::credentials::persistence::get(conn, key, &connection.secret)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::SecretNotFound, "No such secret"))?
        .spec;
    let location = location.within(&spec).map_err(Refusal::invalid)?;
    Ok((location, spec))
}

/// The source connection `name`: what a member reads, and never writes. The
/// sink is reached only through its graphs.
pub fn source(conn: &rusqlite::Connection, name: &str) -> Result<ConnectionView, Refusal> {
    let connection = persistence::get(conn, name)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::ConnectionNotFound, "No such connection"))?;
    if connection.target.direction != Direction::Source {
        return Err(Refusal::invalid(format!(
            "{name:?} is not a storage source"
        )));
    }
    Ok(connection)
}
