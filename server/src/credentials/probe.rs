//! Validation: prove a credential does what its connections need of it — LIST
//! a source, WRITE and DELETE under the sink. Every probe of one request runs
//! at once, each within the store's deadline, so a store that hangs fails its
//! check by name before the request's own deadline fires.

use futures::StreamExt;
use futures::future::join_all;
use object_store::PutPayload;

use crate::domain::{
    Check, ConnectionView, Direction, Operation, Outcome, StorageCredentialInput, StorageLocation,
    StorageTarget, ValidationReport,
};
use crate::storage_client::{self, STORE_DEADLINE, bounded};

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

/// LIST under `url`: the first page is proof enough.
async fn list(credential: &StorageCredentialInput, url: &str) -> Check {
    let listed = bounded(STORE_DEADLINE, async {
        let url = StorageLocation::parse(url)?;
        let store = storage_client::store(credential, &url)?;
        match store.list(url.path()).next().await {
            Some(Err(e)) => Err(e.to_string()),
            _ => Ok(None),
        }
    });
    check(Operation::List, listed.await.map_err(|e| e.to_string()))
}

/// WRITE an object under the sink, then DELETE it: a listing would only prove
/// the credential can read.
async fn write_delete(credential: &StorageCredentialInput, url: &str) -> Vec<Check> {
    let (store, url) = match StorageLocation::parse(url)
        .and_then(|url| Ok((storage_client::store(credential, &url)?, url)))
    {
        Ok(opened) => opened,
        Err(e) => return vec![check(Operation::Write, Err(e))],
    };
    let probe = url
        .path()
        .child(format!("keasy-validate-{}", uuid::Uuid::new_v4()));
    let probed = bounded(STORE_DEADLINE, async {
        if let Err(e) = store.put(&probe, PutPayload::new()).await {
            return Ok(Err(e.to_string()));
        }
        Ok(Ok(store.delete(&probe).await.map_err(|e| e.to_string())))
    })
    .await;
    match probed {
        Err(silent) => vec![check(Operation::Write, Err(silent.to_string()))],
        Ok(Err(e)) => vec![check(Operation::Write, Err(e))],
        Ok(Ok(deleted)) => vec![
            check(Operation::Write, Ok(None)),
            check(Operation::Delete, deleted.map(|()| None)),
        ],
    }
}

async fn storage(credential: &StorageCredentialInput, target: &StorageTarget) -> Vec<Check> {
    match target.direction {
        Direction::Source => vec![list(credential, &target.url).await],
        Direction::Sink => write_delete(credential, &target.url).await,
    }
}

/// What `target` needs of `spec`, probed.
pub async fn connection(spec: &StorageCredentialInput, target: &StorageTarget) -> ValidationReport {
    report(storage(spec, target).await)
}

/// A credential, probed through every connection that uses it and at `url`
/// when given, and the dependents that failed. A credential with nothing to
/// reach says so.
pub async fn credential(
    spec: &StorageCredentialInput,
    url: Option<&str>,
    dependents: &[ConnectionView],
) -> (ValidationReport, Vec<String>) {
    let (through_dependents, at_url) = futures::join!(
        join_all(dependents.iter().map(|d| storage(spec, &d.target))),
        async {
            match url {
                Some(url) => Some(list(spec, url).await),
                None => None,
            }
        },
    );
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
    (report(checks), failing)
}
