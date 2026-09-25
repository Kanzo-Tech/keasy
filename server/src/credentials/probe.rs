//! Validation: prove a credential does what its connections need of it — LIST
//! a source, WRITE and DELETE under the sink, list a provider's models.

use futures::StreamExt;
use object_store::PutPayload;

use crate::api::connections::{
    ConnectionTarget, ConnectionView, Direction, ModelTarget, StorageTarget,
};
use crate::api::credentials::{CredentialSpecInput, ModelCredentialInput, StorageCredentialInput};
use crate::api::validation::{Check, Operation, Outcome, ValidationReport};

use crate::domain::StorageUrl;
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
        at: crate::jobs::now_iso8601(),
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
        let url = StorageUrl::parse(url)?;
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
    let (store, url) = match StorageUrl::parse(url)
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

/// Whether the model the target runs is among those the key may call.
fn offers(
    credential: &ModelCredentialInput,
    target: &ModelTarget,
    listed: &Result<Vec<String>, String>,
) -> Check {
    let model = target
        .model
        .as_deref()
        .unwrap_or(credential.default_model());
    check(
        Operation::Models,
        match listed {
            Err(e) => Err(e.clone()),
            Ok(ids) if ids.iter().any(|id| id == model) => Ok(Some(model.to_string())),
            Ok(_) => Err(format!("{model} is not a model this key may call")),
        },
    )
}

/// What `target` needs of `spec`, probed.
pub async fn connection(spec: &CredentialSpecInput, target: &ConnectionTarget) -> ValidationReport {
    report(match (spec, target) {
        (CredentialSpecInput::Storage(s), ConnectionTarget::Storage(t)) => storage(s, t).await,
        (CredentialSpecInput::Model(m), ConnectionTarget::Model(t)) => {
            vec![offers(m, t, &crate::ai::client::models(m).await)]
        }
        _ => vec![check(
            Operation::List,
            Err("the credential is of another purpose".into()),
        )],
    })
}

/// A credential, probed through every connection that uses it and at `url`
/// when given, and the dependents that failed. A model credential lists its
/// models whatever else it does; a storage credential with nothing to reach
/// says so.
pub async fn credential(
    spec: &CredentialSpecInput,
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
    match spec {
        CredentialSpecInput::Model(m) => {
            let listed = crate::ai::client::models(m).await;
            checks.push(check(
                Operation::Models,
                listed
                    .as_ref()
                    .map(|ids| Some(format!("{} models", ids.len())))
                    .map_err(Clone::clone),
            ));
            for d in dependents {
                if let ConnectionTarget::Model(t) = &d.target {
                    add(&d.name, vec![offers(m, t, &listed)], &mut checks);
                }
            }
        }
        CredentialSpecInput::Storage(s) => {
            for d in dependents {
                if let ConnectionTarget::Storage(t) = &d.target {
                    add(&d.name, storage(s, t).await, &mut checks);
                }
            }
            if let Some(url) = url {
                checks.push(list(s, url).await);
            }
            if checks.is_empty() {
                checks.push(Check {
                    operation: Operation::List,
                    result: Outcome::Skip,
                    message: Some("no connection uses it and no URL was given to list".into()),
                });
            }
        }
    }
    (report(checks), failing)
}
