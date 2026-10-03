//! A storage credential turned into an object store client, and the few
//! operations keasy performs with one: vend, list, and the sink's write probe.

pub mod vend;

use std::future::Future;
use std::time::Duration;

use axum::http::StatusCode;
use futures::StreamExt;
use futures::stream::BoxStream;
use object_store::aws::{AmazonS3, AmazonS3Builder};
use object_store::azure::{MicrosoftAzure, MicrosoftAzureBuilder};
use object_store::path::Path as ObjectPath;
use object_store::{
    BackoffConfig, ClientOptions, ObjectMeta, ObjectStore, PutPayload, RetryConfig,
};
use secrecy::ExposeSecret;

use crate::domain::{StorageCredentialInput, StorageLocation, StoreKind};
use crate::error::{ErrorCode, Refusal};
use crate::startup::REQUEST_DEADLINE;

/// How long the store may take to accept a connection.
const STORE_CONNECT: Duration = Duration::from_secs(5);
/// One request to the store, its connect included.
const STORE_REQUEST: Duration = Duration::from_secs(8);
/// Retries of a request that failed or timed out, and the longest wait before one.
const STORE_RETRIES: u32 = 1;
const STORE_MAX_BACKOFF: Duration = Duration::from_secs(1);

/// The longest one call can take: every attempt timing out, each after the
/// longest backoff.
const STORE_CALL: Duration = STORE_REQUEST
    .saturating_mul(STORE_RETRIES + 1)
    .saturating_add(STORE_MAX_BACKOFF.saturating_mul(STORE_RETRIES));

/// One store operation whole — a listing's every page, a probe's write and
/// delete. Past it the store is `store/silent`: under the server's request
/// deadline, so the code that reaches the screen names the store.
pub const STORE_DEADLINE: Duration = Duration::from_secs(20);

const _: () = assert!(
    STORE_CALL.as_millis() <= STORE_DEADLINE.as_millis(),
    "a call that fails, retries included, fails inside the operation's deadline"
);
const _: () = assert!(
    STORE_DEADLINE.as_millis() < REQUEST_DEADLINE.as_millis(),
    "the store is named before the server's request deadline fires"
);

fn client_options() -> ClientOptions {
    ClientOptions::new()
        .with_connect_timeout(STORE_CONNECT)
        .with_timeout(STORE_REQUEST)
}

fn retry() -> RetryConfig {
    RetryConfig {
        backoff: BackoffConfig {
            max_backoff: STORE_MAX_BACKOFF,
            ..BackoffConfig::default()
        },
        max_retries: STORE_RETRIES as usize,
        retry_timeout: STORE_CALL,
    }
}

/// Why the store did not do what it was asked: it said no, or it said nothing
/// in time.
#[derive(Debug)]
pub enum StoreFailure {
    Refused(String),
    /// `who` did not answer within `after`.
    Silent {
        who: &'static str,
        after: Duration,
    },
}

impl std::fmt::Display for StoreFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(message) => f.write_str(message),
            Self::Silent { who, after } => {
                write!(f, "{who} did not answer within {} s", after.as_secs_f64())
            }
        }
    }
}

impl From<String> for StoreFailure {
    fn from(message: String) -> Self {
        Self::Refused(message)
    }
}

impl From<&str> for StoreFailure {
    fn from(message: &str) -> Self {
        Self::Refused(message.to_string())
    }
}

/// A store that said no is `store/refused` (502), one that said nothing in
/// time `store/silent` (504) — whatever the server asked it.
impl From<StoreFailure> for Refusal {
    fn from(e: StoreFailure) -> Self {
        match e {
            StoreFailure::Refused(message) => {
                Refusal::new(StatusCode::BAD_GATEWAY, ErrorCode::StoreRefused, message)
            }
            silent @ StoreFailure::Silent { after, .. } => Refusal::silent(
                StatusCode::GATEWAY_TIMEOUT,
                ErrorCode::StoreSilent,
                silent.to_string(),
                after,
            ),
        }
    }
}

/// Whether `e`, or anything it was caused by, is a request that timed out.
/// object_store's own `HttpError` is never in the chain — its wrapper is
/// transparent — so the client's error is what says so.
fn timed_out(e: &(dyn std::error::Error + 'static)) -> bool {
    let mut next = Some(e);
    while let Some(e) = next {
        if e.downcast_ref::<reqwest::Error>()
            .is_some_and(reqwest::Error::is_timeout)
        {
            return true;
        }
        if let Some(io) = e.downcast_ref::<std::io::Error>()
            && io.kind() == std::io::ErrorKind::TimedOut
        {
            return true;
        }
        next = e.source();
    }
    false
}

/// An object store failure: the store silent when its requests timed out,
/// retries included, and a refusal in its own words otherwise.
pub fn failure(e: object_store::Error) -> StoreFailure {
    if timed_out(&e) {
        StoreFailure::Silent {
            who: "The store",
            after: STORE_REQUEST,
        }
    } else {
        StoreFailure::Refused(e.to_string())
    }
}

/// A refusal's words, for a caller that reports a refusal and answers a
/// silence whole.
pub fn refused(e: object_store::Error) -> Result<String, StoreFailure> {
    match failure(e) {
        StoreFailure::Refused(message) => Ok(message),
        silent => Err(silent),
    }
}

/// `operation`, or the store named silent once `deadline` passes without it.
pub async fn bounded<T>(
    deadline: Duration,
    operation: impl Future<Output = Result<T, StoreFailure>>,
) -> Result<T, StoreFailure> {
    tokio::time::timeout(deadline, operation)
        .await
        .unwrap_or(Err(StoreFailure::Silent {
            who: "The store",
            after: deadline,
        }))
}

/// An object store client that keeps its provider, so it can sign.
pub enum CloudStore {
    Azure(MicrosoftAzure),
    S3(AmazonS3),
}

/// The client `credential` opens on the bucket or container `location` names.
pub fn store(
    credential: &StorageCredentialInput,
    location: &StorageLocation,
) -> Result<CloudStore, String> {
    if StoreKind::of(credential) != location.kind() {
        return Err(format!(
            "this credential reaches {} URLs, not {}",
            StoreKind::of(credential).spellings(),
            location.kind().spellings()
        ));
    }
    let bucket = location.bucket();

    let store = match credential {
        StorageCredentialInput::S3 {
            access_key_id,
            secret_access_key,
            region,
            endpoint,
            ..
        } => {
            let mut builder = AmazonS3Builder::new()
                .with_bucket_name(bucket)
                .with_access_key_id(access_key_id)
                .with_secret_access_key(secret_access_key.expose_secret())
                .with_region(region)
                .with_client_options(client_options())
                .with_retry(retry());
            if let Some(endpoint) = endpoint {
                // object_store refuses plain HTTP unless told; an `http://`
                // endpoint (a dev store on a laptop) is that telling.
                builder = builder
                    .with_endpoint(endpoint)
                    .with_allow_http(endpoint.starts_with("http://"));
            }
            CloudStore::S3(builder.build().map_err(|e| e.to_string())?)
        }
        StorageCredentialInput::AzureAccountKey { account, key } => CloudStore::Azure(
            azure(bucket, account)
                .with_access_key(key.expose_secret())
                .build()
                .map_err(|e| e.to_string())?,
        ),
        StorageCredentialInput::AzureServicePrincipal {
            account,
            tenant_id,
            client_id,
            client_secret,
        } => CloudStore::Azure(
            azure(bucket, account)
                .with_tenant_id(tenant_id)
                .with_client_id(client_id)
                .with_client_secret(client_secret.expose_secret())
                .build()
                .map_err(|e| e.to_string())?,
        ),
    };
    Ok(store)
}

fn azure(container: &str, account: &str) -> MicrosoftAzureBuilder {
    MicrosoftAzureBuilder::new()
        .with_container_name(container)
        .with_account(account)
        .with_client_options(client_options())
        .with_retry(retry())
}

impl CloudStore {
    pub async fn put(&self, path: &ObjectPath, payload: PutPayload) -> object_store::Result<()> {
        match self {
            Self::Azure(s) => s.put(path, payload).await.map(drop),
            Self::S3(s) => s.put(path, payload).await.map(drop),
        }
    }

    pub async fn delete(&self, path: &ObjectPath) -> object_store::Result<()> {
        match self {
            Self::Azure(s) => s.delete(path).await,
            Self::S3(s) => s.delete(path).await,
        }
    }

    /// Everything under `prefix`; the whole bucket for the empty path.
    pub fn list(&self, prefix: &ObjectPath) -> BoxStream<'_, object_store::Result<ObjectMeta>> {
        let prefix = (!prefix.as_ref().is_empty()).then_some(prefix);
        match self {
            Self::Azure(s) => s.list(prefix),
            Self::S3(s) => s.list(prefix),
        }
    }
}

/// Every object under `location`, within [`STORE_DEADLINE`].
pub async fn list_files(
    credential: &StorageCredentialInput,
    location: &StorageLocation,
) -> Result<Vec<ObjectMeta>, StoreFailure> {
    let store = store(credential, location)?;
    bounded(STORE_DEADLINE, async {
        let mut entries = Vec::new();
        let mut listing = store.list(location.path());
        while let Some(meta) = listing.next().await {
            entries.push(meta.map_err(failure)?);
        }
        Ok(entries)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy::SecretString;

    fn s3() -> StorageCredentialInput {
        StorageCredentialInput::S3 {
            access_key_id: "AK".into(),
            secret_access_key: SecretString::from("SK"),
            region: "us-east-1".into(),
            endpoint: None,
            role_arn: None,
            external_id: None,
        }
    }

    #[tokio::test]
    async fn an_operation_past_its_deadline_names_the_store_silent() {
        let after = Duration::from_millis(50);
        let hung = bounded(after, std::future::pending::<Result<(), StoreFailure>>()).await;
        assert!(matches!(hung, Err(StoreFailure::Silent { after: a, .. }) if a == after));
        let refused = bounded(after, async { Err::<(), _>(StoreFailure::from("no")) }).await;
        assert!(matches!(refused, Err(StoreFailure::Refused(m)) if m == "no"));
    }

    #[test]
    fn a_credential_opens_only_its_own_stores() {
        let url = |s: &str| StorageLocation::parse(s).unwrap();
        assert!(store(&s3(), &url("s3://bucket/data/x.csv")).is_ok());
        assert!(store(&s3(), &url("az://container/x.csv")).is_err());
    }
}
