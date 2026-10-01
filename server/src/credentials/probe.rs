//! Validation: prove a credential does what its connections need of it — LIST
//! a source, WRITE and DELETE under the sink.

use futures::StreamExt;
use object_store::PutPayload;

use crate::domain::{
    Check, ConnectionView, Direction, Operation, Outcome, StorageCredentialInput, StorageLocation,
    StorageTarget, ValidationReport,
};
use crate::storage_client;

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
    let listed = async {
        let url = StorageLocation::parse(url)?;
        let store = storage_client::store(credential, &url)?;
        match store.list(url.path()).next().await {
            Some(Err(e)) => Err(e.to_string()),
            _ => Ok(None),
        }
    };
    check(Operation::List, listed.await)
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
    if let Err(e) = store.put(&probe, PutPayload::new()).await {
        return vec![check(Operation::Write, Err(e.to_string()))];
    }
    let deleted = store.delete(&probe).await.map_err(|e| e.to_string());
    vec![
        check(Operation::Write, Ok(None)),
        check(Operation::Delete, deleted.map(|()| None)),
    ]
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
    let mut checks = Vec::new();
    let mut failing = Vec::new();
    let mut add = |name: &str, found: Vec<Check>, checks: &mut Vec<Check>| {
        if found.iter().any(|c| c.result == Outcome::Fail) {
            failing.push(name.to_string());
        }
        checks.extend(through(name, found));
    };
    for d in dependents {
        add(&d.name, storage(spec, &d.target).await, &mut checks);
    }
    if let Some(url) = url {
        checks.push(list(spec, url).await);
    }
    if checks.is_empty() {
        checks.push(Check {
            operation: Operation::List,
            result: Outcome::Skip,
            message: Some("no connection uses it and no URL was given to list".into()),
        });
    }
    (report(checks), failing)
}
