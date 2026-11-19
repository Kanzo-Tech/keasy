//! Connections: a storage location, by name. Nothing here opens one: every
//! credential is the storage service's, vended for one request.

pub mod persistence;
pub mod probe;

use crate::authentication::role::AccessToken;
use crate::database::Database;
use crate::domain::{
    Actor, ConnectionView, Direction, Provenance, ResourceName, StorageLocation, StorageTarget,
};
use crate::error::{Refusal, ServerCode};
use crate::storage_client::StorageService;

/// The connection `name`, or 404.
pub async fn named(db: &Database, name: &str) -> Result<ConnectionView, Refusal> {
    persistence::get(&*db.read().await, name)?
        .ok_or_else(|| Refusal::new(ServerCode::ConnectionNotFound, "No such connection"))
}

/// Refuse a storage location that shares a prefix with another connection's,
/// the sink's included — Unity Catalog's rule that external locations never
/// overlap. With it, every object has at most one connection over it, and a
/// source can never reach into the sink.
async fn disjoint(
    db: &Database,
    mine: &StorageLocation,
    name: Option<&str>,
) -> Result<(), Refusal> {
    let conn = db.read().await;
    let mut overlapping = Vec::new();
    for other in persistence::list(&conn)?
        .iter()
        .filter(|o| Some(o.name.as_str()) != name)
    {
        if location(other)?.overlaps(mine) {
            overlapping.push(other.name.clone());
        }
    }
    if overlapping.is_empty() {
        return Ok(());
    }
    Err(Refusal::overlaps(
        format!(
            "{mine} overlaps the location of {}: a prefix belongs to one connection",
            overlapping.join(", ")
        ),
        overlapping,
    ))
}

/// Who checks a connection before it is stored: the person saving it, whose
/// token the storage service vends to. `None` stores it untested — what the
/// instance declares at boot, before anyone has signed in.
pub struct Prober<'a> {
    pub service: &'a StorageService,
    pub token: &'a AccessToken,
}

/// Check, probe and store `connection` as `name`'s new state (a new one when
/// `name` is `None`). A connection that does not validate is not stored. The
/// URL is stored in its canonical form, which is the form every reader expands.
pub async fn save(
    db: &Database,
    name: Option<&str>,
    mut connection: ConnectionView,
    by: &Actor,
    prober: Option<Prober<'_>>,
) -> Result<ConnectionView, Refusal> {
    ResourceName::parse(&connection.name).map_err(|e| Refusal::invalid_field("name", e))?;
    let canonical = StorageLocation::parse(&connection.target.url)
        .map_err(|e| Refusal::invalid_field("url", e))?;
    connection.target.url = canonical.to_string();
    disjoint(db, &canonical, name).await?;
    if let Some(Prober { service, token }) = prober {
        let report = probe::connection(service, token, &connection.target).await?;
        if !report.passed() {
            return Err(Refusal::probe_failed(report.failures()));
        }
        connection.validation = Some(report.taken_by(by));
    }

    let conn = db.write().await;
    match name {
        None => persistence::insert(&conn, &connection, by)?,
        Some(name) => persistence::update(&conn, name, &connection, by)?,
    }
    persistence::get(&conn, &connection.name)?
        .ok_or_else(|| Refusal::new(ServerCode::ConnectionNotFound, "No such connection"))
}

pub async fn create(
    db: &Database,
    name: String,
    target: StorageTarget,
    by: &Actor,
    prober: Option<Prober<'_>>,
) -> Result<ConnectionView, Refusal> {
    let connection = ConnectionView {
        name,
        target,
        owner: by.as_owner(),
        provenance: Provenance::created(by.clone()),
        validation: None,
        can: Default::default(),
    };
    save(db, None, connection, by, prober).await
}

/// A storage connection's location.
pub fn location(connection: &ConnectionView) -> Result<StorageLocation, Refusal> {
    StorageLocation::parse(&connection.target.url).map_err(Refusal::invalid)
}

/// The source connection `name`: what a member reads, and never writes. The
/// sink is reached only through its graphs.
pub fn source(conn: &rusqlite::Connection, name: &str) -> Result<ConnectionView, Refusal> {
    let connection = persistence::get(conn, name)?
        .ok_or_else(|| Refusal::new(ServerCode::ConnectionNotFound, "No such connection"))?;
    if connection.target.direction != Direction::Source {
        return Err(Refusal::invalid(format!(
            "{name:?} is not a storage source"
        )));
    }
    Ok(connection)
}
