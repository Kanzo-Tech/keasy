//! Validation: prove a credential does what its connections need of it — LIST
//! a source, WRITE and DELETE under the sink. Every probe of one request runs
//! at once, each within the store's deadline, so a store that hangs answers
//! the request as `store/silent` before the request's own deadline fires.

use futures::StreamExt;
use futures::future::join_all;
use object_store::PutPayload;

use crate::domain::{
    Check, ConnectionView, Direction, Operation, Outcome, SecretSpec, StorageLocation,
    StorageTarget, ValidationReport,
};
use crate::storage_client::{self, Endpoints, STORE_DEADLINE, StoreFailure, bounded, refused};

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

fn report(results: Vec<Check>) -> ValidationReport {
    ValidationReport {
        at: crate::domain::now_iso8601(),
        results,
        by: None,
    }
}

/// `checks`, each saying which connection it was made through.
fn through(name: &str, checks: Vec<Check>) -> Vec<Check> {
    checks
        .into_iter()
        .map(|mut c| {
            c.message = Some(match c.message {
                Some(m) => format!("{name}: {m}"),
                None => name.to_string(),
            });
            c
        })
        .collect()
}

/// The store `url` names, opened with `credential`, or why it could not be.
fn open(
    credential: &SecretSpec,
    url: &str,
    endpoints: &Endpoints,
) -> Result<(storage_client::CloudStore, StorageLocation), String> {
    let url = StorageLocation::parse(url)?;
    Ok((storage_client::store(credential, &url, endpoints)?, url))
}

/// LIST under `url`: the first page is proof enough.
async fn list(
    credential: &SecretSpec,
    url: &str,
    endpoints: &Endpoints,
) -> Result<Check, StoreFailure> {
    let (store, url) = match open(credential, url, endpoints) {
        Ok(opened) => opened,
        Err(e) => return Ok(check(Operation::List, Err(e))),
    };
    let listed = bounded(STORE_DEADLINE, async {
        match store.list(url.path()).next().await {
            Some(Err(e)) => Ok(Err(refused(e)?)),
            _ => Ok(Ok(None)),
        }
    })
    .await?;
    Ok(check(Operation::List, listed))
}

/// WRITE an object under the sink, then DELETE it: a listing would only prove
/// the credential can read.
async fn write_delete(
    credential: &SecretSpec,
    url: &str,
    endpoints: &Endpoints,
) -> Result<Vec<Check>, StoreFailure> {
    let (store, url) = match open(credential, url, endpoints) {
        Ok(opened) => opened,
        Err(e) => return Ok(vec![check(Operation::Write, Err(e))]),
    };
    let probe = url
        .path()
        .child(format!("keasy-validate-{}", uuid::Uuid::new_v4()));
    let probed = bounded(STORE_DEADLINE, async {
        if let Err(e) = store.put(&probe, PutPayload::new()).await {
            return Ok(Err(refused(e)?));
        }
        Ok(Ok(match store.delete(&probe).await {
            Ok(()) => None,
            Err(e) => Some(refused(e)?),
        }))
    })
    .await?;
    Ok(match probed {
        Err(e) => vec![check(Operation::Write, Err(e))],
        Ok(deleted) => vec![
            check(Operation::Write, Ok(None)),
            check(Operation::Delete, deleted.map_or(Ok(None), Err)),
        ],
    })
}

async fn storage(
    credential: &SecretSpec,
    target: &StorageTarget,
    endpoints: &Endpoints,
) -> Result<Vec<Check>, StoreFailure> {
    match target.direction {
        Direction::Source => Ok(vec![list(credential, &target.url, endpoints).await?]),
        Direction::Sink => write_delete(credential, &target.url, endpoints).await,
    }
}

/// What `target` needs of `spec`, probed; a store that does not answer is
/// the whole answer, not a failed check.
pub async fn connection(
    spec: &SecretSpec,
    target: &StorageTarget,
    endpoints: &Endpoints,
) -> Result<ValidationReport, StoreFailure> {
    Ok(report(storage(spec, target, endpoints).await?))
}

/// A credential, probed through every connection that uses it and at `url`
/// when given, and the dependents that failed. A credential with nothing to
/// reach says so; a store that does not answer is the whole answer.
pub async fn credential(
    spec: &SecretSpec,
    url: Option<&str>,
    dependents: &[ConnectionView],
    endpoints: &Endpoints,
) -> Result<(ValidationReport, Vec<String>), StoreFailure> {
    let (through_dependents, at_url) = futures::join!(
        join_all(
            dependents
                .iter()
                .map(|d| storage(spec, &d.target, endpoints))
        ),
        async {
            match url {
                Some(url) => Some(list(spec, url, endpoints).await),
                None => None,
            }
        },
    );
    let through_dependents = through_dependents
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let at_url = at_url.transpose()?;
    let mut checks = Vec::new();
    let mut failing = Vec::new();
    for (d, found) in dependents.iter().zip(through_dependents) {
        if found.iter().any(|c| c.result == Outcome::Fail) {
            failing.push(d.name.clone());
        }
        checks.extend(through(&d.name, found));
    }
    checks.extend(at_url);
    if checks.is_empty() {
        checks.push(Check {
            operation: Operation::List,
            result: Outcome::Skip,
            message: Some("no connection uses it and no URL was given to list".into()),
        });
    }
    Ok((report(checks), failing))
}
