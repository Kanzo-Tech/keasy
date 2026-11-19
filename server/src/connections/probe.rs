//! Validation: prove a connection does what keasy will ask of it — LIST a
//! source, WRITE under the sink — with the credentials the storage service
//! vends for it, to the person who asked. A probe is a person's: the service
//! vends to a member's token, so a connection the instance declares at boot
//! is tested the first time someone tests it. A store that hangs answers the
//! request as `store/silent` before the request's own deadline fires.

use futures::StreamExt;
use object_store::PutPayload;

use crate::authentication::role::AccessToken;
use crate::domain::{
    Access, Check, Direction, Operation, Outcome, StorageLocation, StorageTarget, ValidationReport,
};
use crate::storage_client::{STORE_DEADLINE, StorageService, StoreFailure, bounded, refused};

/// The object a sink's probe writes, the same one each time: a write
/// credential cannot delete, so the probe leaves one object behind and never
/// a second.
pub const PROBE_OBJECT: &str = ".keasy-validate";

fn check(operation: Operation, outcome: Result<Option<String>, String>) -> Check {
    match outcome {
        Ok(message) => Check {
            operation,
            result: Outcome::Pass,
            message,
        },
        Err(message) => Check {
            operation,
            result: Outcome::Fail,
            message: Some(message),
        },
    }
}

/// A refusal is the check's answer; a silence, and a location the deployment
/// does not hold, are the whole request's.
fn failed(e: StoreFailure) -> Result<String, StoreFailure> {
    match e {
        StoreFailure::Refused(message) => Ok(message),
        other => Err(other),
    }
}

/// LIST under `location`: the first page is proof enough.
async fn list(
    service: &StorageService,
    token: &AccessToken,
    location: &StorageLocation,
) -> Result<Check, StoreFailure> {
    let listed = bounded(STORE_DEADLINE, async {
        let credential = match service.vend(location, Access::Read, token).await {
            Ok(credential) => credential,
            Err(e) => return Ok(Err(failed(e)?)),
        };
        let store = match crate::storage_client::store(&credential, location) {
            Ok(store) => store,
            Err(e) => return Ok(Err(e)),
        };
        match store.list(location.path()).next().await {
            Some(Err(e)) => Ok(Err(refused(e)?)),
            _ => Ok(Ok(None)),
        }
    })
    .await?;
    Ok(check(Operation::List, listed))
}

/// WRITE [`PROBE_OBJECT`] under the sink: a listing would only prove the
/// credential can read.
async fn write(
    service: &StorageService,
    token: &AccessToken,
    location: &StorageLocation,
) -> Result<Check, StoreFailure> {
    let wrote = bounded(STORE_DEADLINE, async {
        let credential = match service.vend(location, Access::Write, token).await {
            Ok(credential) => credential,
            Err(e) => return Ok(Err(failed(e)?)),
        };
        let store = match crate::storage_client::store(&credential, location) {
            Ok(store) => store,
            Err(e) => return Ok(Err(e)),
        };
        match store
            .put(&location.path().child(PROBE_OBJECT), PutPayload::new())
            .await
        {
            Ok(()) => Ok(Ok(None)),
            Err(e) => Ok(Err(refused(e)?)),
        }
    })
    .await?;
    Ok(check(Operation::Write, wrote))
}

/// What `target` needs, probed for the person `token` names. A store that does
/// not answer, or a location the deployment does not hold, is the whole
/// answer, not a failed check.
pub async fn connection(
    service: &StorageService,
    token: &AccessToken,
    target: &StorageTarget,
) -> Result<ValidationReport, StoreFailure> {
    let location = StorageLocation::parse(&target.url).map_err(StoreFailure::Refused)?;
    let results = match target.direction {
        Direction::Source => vec![list(service, token, &location).await?],
        Direction::Sink => vec![write(service, token, &location).await?],
    };
    Ok(ValidationReport {
        at: crate::domain::now_iso8601(),
        results,
        by: None,
    })
}
