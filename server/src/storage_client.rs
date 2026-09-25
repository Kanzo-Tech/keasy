//! A storage credential turned into an object store client, and the few
//! operations keasy performs with one: sign, list, and the sink's write probe.

use std::time::Duration;

use axum::http::Method;
use futures::StreamExt;
use futures::stream::BoxStream;
use object_store::aws::{AmazonS3, AmazonS3Builder};
use object_store::azure::{AzureConfigKey, MicrosoftAzure, MicrosoftAzureBuilder};
use object_store::path::Path as ObjectPath;
use object_store::signer::Signer;
use object_store::{ClientOptions, ObjectMeta, ObjectStore, PutPayload, RetryConfig};
use secrecy::ExposeSecret;
use url::Url;

use keasy_api::connections::FileEntry;
use keasy_api::credentials::StorageCredentialInput;

use crate::domain::{StorageScheme, StorageUrl};

pub const SIGNED_URL_EXPIRES: Duration = Duration::from_secs(300);

/// The store a credential reaches.
fn reaches(credential: &StorageCredentialInput) -> StorageScheme {
    match credential {
        StorageCredentialInput::S3 { .. } => StorageScheme::S3,
        StorageCredentialInput::AzureAccountKey { .. }
        | StorageCredentialInput::AzureSas { .. }
        | StorageCredentialInput::AzureServicePrincipal { .. } => StorageScheme::Azure,
    }
}

/// A client-supplied path under a base URL: relative, no scheme, no `..`
/// leaving the base, no quote to close a SQL literal with.
pub(crate) fn relative_path(path: &str) -> Result<(), String> {
    let invalid = |why: &str| Err(format!("{path:?} {why}"));
    if path.is_empty() {
        return invalid("is empty");
    }
    if path.starts_with(['/', '\\']) || path.contains(':') {
        return invalid("must be relative");
    }
    if path.split(['/', '\\']).any(|segment| segment == "..") {
        return invalid("must not leave its base");
    }
    if path.contains(['\'', '"', '\0']) {
        return invalid("must not contain quotes");
    }
    Ok(())
}

/// A probe or a listing is a question a person is waiting on: a store that
/// does not answer is a failed check in seconds, not after object_store's
/// default three minutes of retries.
fn client_options() -> ClientOptions {
    ClientOptions::new()
        .with_connect_timeout(Duration::from_secs(5))
        .with_timeout(Duration::from_secs(30))
}

fn retry() -> RetryConfig {
    RetryConfig {
        max_retries: 2,
        retry_timeout: Duration::from_secs(10),
        ..RetryConfig::default()
    }
}

/// An object store client that keeps its provider, so it can sign.
pub enum CloudStore {
    Azure(MicrosoftAzure),
    S3(AmazonS3),
}

/// The client `credential` opens on the bucket or container `url` names.
pub fn store(credential: &StorageCredentialInput, url: &StorageUrl) -> Result<CloudStore, String> {
    if reaches(credential) != url.scheme() {
        return Err(format!(
            "this credential reaches {} URLs, not {}",
            reaches(credential).spellings(),
            url.scheme().spellings()
        ));
    }
    let bucket = url.bucket();

    let store = match credential {
        StorageCredentialInput::S3 {
            access_key_id,
            secret_access_key,
            region,
            endpoint,
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
                // endpoint (MinIO on a laptop) is that telling.
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
        StorageCredentialInput::AzureSas { account, sas_token } => CloudStore::Azure(
            azure(bucket, account)
                .with_config(AzureConfigKey::SasKey, sas_token.expose_secret())
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
    pub async fn sign_url(
        &self,
        method: Method,
        path: &ObjectPath,
        expires_in: Duration,
    ) -> object_store::Result<Url> {
        match self {
            Self::Azure(s) => s.signed_url(method, path, expires_in).await,
            Self::S3(s) => s.signed_url(method, path, expires_in).await,
        }
    }

    pub async fn sign_urls(
        &self,
        method: Method,
        paths: &[ObjectPath],
        expires_in: Duration,
    ) -> object_store::Result<Vec<Url>> {
        match self {
            Self::Azure(s) => s.signed_urls(method, paths, expires_in).await,
            Self::S3(s) => s.signed_urls(method, paths, expires_in).await,
        }
    }

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

/// Every object under the connection `url` is.
pub async fn list_files(
    credential: &StorageCredentialInput,
    url: &StorageUrl,
) -> Result<Vec<FileEntry>, String> {
    let store = store(credential, url)?;
    let mut entries = Vec::new();
    let mut listing = store.list(url.path());
    while let Some(meta) = listing.next().await {
        let meta = meta.map_err(|e| format!("listing failed: {e}"))?;
        entries.push(FileEntry {
            path: meta.location.to_string(),
            size: meta.size,
            last_modified: Some(meta.last_modified.to_string()),
        });
    }
    Ok(entries)
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
        }
    }

    #[test]
    fn a_client_path_stays_under_its_base() {
        for ok in ["Person.parquet", "vertex/Person/chunk0.parquet"] {
            assert!(relative_path(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../other-job/Person.parquet",
            "vertex/../../x.parquet",
            "s3://elsewhere/x.parquet",
            "it's.parquet",
            "a\"b.parquet",
        ] {
            assert!(relative_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_credential_opens_only_its_own_stores() {
        let url = |s: &str| StorageUrl::parse(s).unwrap();
        assert!(store(&s3(), &url("s3://bucket/data/x.csv")).is_ok());
        assert!(store(&s3(), &url("az://container/x.csv")).is_err());
    }
}
