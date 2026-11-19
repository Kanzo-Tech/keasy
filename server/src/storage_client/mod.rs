//! Where every credential comes from, and the few operations keasy performs
//! with one: list a source, and probe a connection.
//!
//! Keasy holds no key of the organization's. A credential is the platform's
//! storage service's (kanzo-ui `services/storage`): asked for one location
//! and one access, with the person's own token, after this server's permission
//! check, and answered as Iceberg REST's `StorageCredential` — STS's session
//! credentials, an Azure directory SAS, a downscoped Google token, each from
//! the cloud's own SDK. What the browser reads and writes with is that
//! credential, handed on unchanged; what this server lists with is the same,
//! opened as an `object_store` client.

use std::collections::BTreeMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use futures::stream::BoxStream;
use object_store::aws::AmazonS3Builder;
use object_store::azure::{AzureConfigKey, MicrosoftAzureBuilder};
use object_store::gcp::{GcpCredential, GoogleCloudStorageBuilder};
use object_store::path::Path as ObjectPath;
use object_store::{
    BackoffConfig, ClientOptions, ObjectMeta, ObjectStore, PutPayload, RetryConfig,
    StaticCredentialProvider,
};
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;

use crate::authentication::role::AccessToken;
use crate::domain::{Access, StorageLocation, Store, VendedCredential};
use crate::error::{Refusal, ServerCode};
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

/// One store operation whole — a listing's every page, a probe's credential
/// and its write. Past it the store is `store/silent`: under the server's request
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
    /// The location is in none of the deployment's storage locations.
    Undeclared(String),
    /// `who` did not answer within `after`.
    Silent {
        who: &'static str,
        after: Duration,
    },
}

impl std::fmt::Display for StoreFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(message) | Self::Undeclared(message) => f.write_str(message),
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
/// time `store/silent` (504) — whatever the server asked it. The storage
/// service in front of it is the store, to whoever asked.
impl From<StoreFailure> for Refusal {
    fn from(e: StoreFailure) -> Self {
        match e {
            StoreFailure::Refused(message) => Refusal::new(ServerCode::StoreRefused, message),
            StoreFailure::Undeclared(message) => {
                Refusal::field(ServerCode::StoreUndeclared, "url", message)
            }
            silent @ StoreFailure::Silent { after, .. } => {
                Refusal::silent(ServerCode::StoreSilent, silent.to_string(), after)
            }
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

/// The platform's storage service: `POST {url}/v1/credentials` `{location,
/// access}`, the person's token in `x-forwarded-access-token`.
#[derive(Clone)]
pub struct StorageService {
    url: Arc<str>,
    http: reqwest::Client,
}

/// What the storage service answers: Iceberg REST's `LoadCredentialsResponse`.
#[derive(Deserialize)]
struct Answer {
    #[serde(rename = "storage-credentials")]
    storage_credentials: Vec<VendedCredential>,
}

/// What it answers instead, as `application/problem+json`: its code is all
/// this server reads.
#[derive(Deserialize)]
struct Refused {
    code: Option<String>,
    detail: Option<String>,
}

impl StorageService {
    pub fn new(url: impl Into<String>) -> Self {
        let url: String = url.into();
        Self {
            url: url.trim_end_matches('/').into(),
            http: reqwest::Client::builder()
                .connect_timeout(STORE_CONNECT)
                .timeout(STORE_REQUEST)
                .build()
                .expect("a client with timeouts builds"),
        }
    }

    /// A credential for `access` on `location` and nothing outside it, for the
    /// person `token` names. Whether they may is this server's to have decided
    /// already; the service decides only that the location is one the
    /// deployment declared, and that the person belongs to its organization.
    pub async fn vend(
        &self,
        location: &StorageLocation,
        access: Access,
        token: &AccessToken,
    ) -> Result<VendedCredential, StoreFailure> {
        let sent = self
            .http
            .post(format!("{}/v1/credentials", self.url))
            .header("x-forwarded-access-token", token.0.expose_secret())
            .json(&serde_json::json!({
                "location": location.to_string(),
                "access": match access { Access::Read => "read", Access::Write => "write" },
            }))
            .send()
            .await;
        let response = match sent {
            Ok(response) => response,
            Err(e) if e.is_timeout() => {
                return Err(StoreFailure::Silent {
                    who: "The storage service",
                    after: STORE_REQUEST,
                });
            }
            Err(e) => return Err(StoreFailure::Refused(format!("the storage service: {e}"))),
        };
        let status = response.status();
        if status.is_success() {
            let answer: Answer = response.json().await.map_err(|e| {
                format!("the storage service answered what is not a credential: {e}")
            })?;
            return answer
                .storage_credentials
                .into_iter()
                .next()
                .ok_or_else(|| "the storage service answered no credential".into());
        }
        let refused: Refused = response.json().await.unwrap_or(Refused {
            code: None,
            detail: None,
        });
        let detail = refused
            .detail
            .unwrap_or_else(|| format!("the storage service answered {status}"));
        Err(match refused.code.as_deref() {
            Some("storage/path") => StoreFailure::Undeclared(detail),
            _ => StoreFailure::Refused(detail),
        })
    }
}

/// An object store client.
pub struct CloudStore(Box<dyn ObjectStore>);

/// A key of the credential's `config`, or why it is missing.
fn key<'a>(config: &'a BTreeMap<String, SecretString>, name: &str) -> Result<&'a str, String> {
    config
        .get(name)
        .map(|v| v.expose_secret())
        .ok_or_else(|| format!("the vended credential has no {name}"))
}

/// The client `credential` opens on the bucket or container `location` names,
/// configured from Iceberg REST's keys and nothing else.
pub fn store(
    credential: &VendedCredential,
    location: &StorageLocation,
) -> Result<CloudStore, String> {
    let config = &credential.config;
    let store: Box<dyn ObjectStore> = match location.store() {
        Store::S3 { bucket } => {
            let mut builder = AmazonS3Builder::new()
                .with_bucket_name(bucket)
                .with_access_key_id(key(config, "s3.access-key-id")?)
                .with_secret_access_key(key(config, "s3.secret-access-key")?)
                .with_token(key(config, "s3.session-token")?)
                .with_region(key(config, "client.region").unwrap_or("us-east-1"))
                .with_client_options(client_options())
                .with_retry(retry());
            if let Ok(endpoint) = key(config, "s3.endpoint") {
                // object_store refuses plain HTTP unless told; an `http://`
                // endpoint (a dev store on a laptop) is that telling.
                builder = builder
                    .with_endpoint(endpoint)
                    .with_allow_http(endpoint.starts_with("http://"));
            }
            Box::new(builder.build().map_err(|e| e.to_string())?)
        }
        Store::Azure { account, container } => {
            let sas = key(
                config,
                &format!("adls.sas-token.{account}.dfs.core.windows.net"),
            )?;
            Box::new(
                MicrosoftAzureBuilder::new()
                    .with_account(account)
                    .with_container_name(container)
                    .with_config(AzureConfigKey::SasKey, sas)
                    .with_client_options(client_options())
                    .with_retry(retry())
                    .build()
                    .map_err(|e| e.to_string())?,
            )
        }
        Store::Gcs { bucket } => {
            let bearer = key(config, "gcs.oauth2.token")?.to_string();
            Box::new(
                GoogleCloudStorageBuilder::new()
                    .with_bucket_name(bucket)
                    .with_credentials(Arc::new(StaticCredentialProvider::new(GcpCredential {
                        bearer,
                    })))
                    .with_client_options(client_options())
                    .with_retry(retry())
                    .build()
                    .map_err(|e| e.to_string())?,
            )
        }
    };
    Ok(CloudStore(store))
}

impl CloudStore {
    pub async fn put(&self, path: &ObjectPath, payload: PutPayload) -> object_store::Result<()> {
        self.0.put(path, payload).await.map(drop)
    }

    /// Everything under `prefix`; the whole bucket for the empty path.
    pub fn list(&self, prefix: &ObjectPath) -> BoxStream<'_, object_store::Result<ObjectMeta>> {
        let prefix = (!prefix.as_ref().is_empty()).then_some(prefix);
        self.0.list(prefix)
    }
}

/// The first `limit` objects under `under` within `location`, within
/// [`STORE_DEADLINE`], and whether there were more: listed with a read
/// credential on `location` the storage service vends to the person `token`
/// names.
pub async fn list_files(
    service: &StorageService,
    token: &AccessToken,
    location: &StorageLocation,
    under: &ObjectPath,
    limit: usize,
) -> Result<(Vec<ObjectMeta>, bool), StoreFailure> {
    bounded(STORE_DEADLINE, async {
        let credential = service.vend(location, Access::Read, token).await?;
        let store = store(&credential, location)?;
        let prefix: ObjectPath = location.path().parts().chain(under.parts()).collect();
        let mut entries = Vec::new();
        let mut listing = store.list(&prefix);
        while let Some(meta) = listing.next().await {
            if entries.len() == limit {
                return Ok((entries, true));
            }
            entries.push(meta.map_err(failure)?);
        }
        Ok((entries, false))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_operation_past_its_deadline_names_the_store_silent() {
        let after = Duration::from_millis(50);
        let hung = bounded(after, std::future::pending::<Result<(), StoreFailure>>()).await;
        assert!(matches!(hung, Err(StoreFailure::Silent { after: a, .. }) if a == after));
        let refused = bounded(after, async { Err::<(), _>(StoreFailure::from("no")) }).await;
        assert!(matches!(refused, Err(StoreFailure::Refused(m)) if m == "no"));
    }

    fn vended(config: &[(&str, &str)]) -> VendedCredential {
        VendedCredential {
            prefix: String::new(),
            config: config
                .iter()
                .map(|(k, v)| (k.to_string(), SecretString::from(*v)))
                .collect(),
        }
    }

    #[test]
    fn a_credential_opens_its_store_from_iceberg_keys_alone() {
        let url = |s: &str| StorageLocation::parse(s).unwrap();
        let s3 = vended(&[
            ("s3.access-key-id", "AK"),
            ("s3.secret-access-key", "SK"),
            ("s3.session-token", "T"),
            ("client.region", "eu-west-1"),
            ("s3.endpoint", "http://127.0.0.1:9000"),
        ]);
        assert!(store(&s3, &url("s3://bucket/data/")).is_ok());
        let sas = vended(&[(
            "adls.sas-token.acct.dfs.core.windows.net",
            "sv=2022-11-02&sr=d&sig=x",
        )]);
        assert!(store(&sas, &url("abfss://c@acct.dfs.core.windows.net/d/")).is_ok());
        assert!(store(&sas, &url("abfss://c@other.dfs.core.windows.net/d/")).is_err());
        assert!(store(&vended(&[("gcs.oauth2.token", "ya29")]), &url("gs://b/d/")).is_ok());
        assert!(store(&vended(&[]), &url("s3://bucket/")).is_err());
    }
}
