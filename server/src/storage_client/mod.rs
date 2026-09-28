//! A storage credential turned into an object store client, and the few
//! operations keasy performs with one: sign, list, and the sink's write probe.

pub mod vend;

use std::time::Duration;

use axum::http::Method;
use futures::StreamExt;
use futures::stream::BoxStream;
use object_store::aws::{AmazonS3, AmazonS3Builder};
use object_store::azure::{MicrosoftAzure, MicrosoftAzureBuilder};
use object_store::path::Path as ObjectPath;
use object_store::signer::Signer;
use object_store::{ClientOptions, ObjectMeta, ObjectStore, PutPayload, RetryConfig};
use secrecy::ExposeSecret;
use url::Url;

use crate::domain::{StorageCredentialInput, StorageLocation, StoreKind};

pub const SIGNED_URL_EXPIRES: Duration = Duration::from_secs(300);

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
    /// A URL `method` may be sent to. S3 binds a signature to its method, so
    /// a HEAD needs its own; an Azure SAS grants a permission instead, and `r`
    /// covers HEAD, which object_store would sign with no permission at all.
    pub async fn sign_url(
        &self,
        method: Method,
        path: &ObjectPath,
        expires_in: Duration,
    ) -> object_store::Result<Url> {
        match self {
            Self::Azure(s) => {
                let method = if method == Method::HEAD {
                    Method::GET
                } else {
                    method
                };
                s.signed_url(method, path, expires_in).await
            }
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

/// Every object under `location`.
pub async fn list_files(
    credential: &StorageCredentialInput,
    location: &StorageLocation,
) -> Result<Vec<ObjectMeta>, String> {
    let store = store(credential, location)?;
    let mut entries = Vec::new();
    let mut listing = store.list(location.path());
    while let Some(meta) = listing.next().await {
        entries.push(meta.map_err(|e| format!("listing failed: {e}"))?);
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
            role_arn: None,
            external_id: None,
        }
    }

    #[test]
    fn a_credential_opens_only_its_own_stores() {
        let url = |s: &str| StorageLocation::parse(s).unwrap();
        assert!(store(&s3(), &url("s3://bucket/data/x.csv")).is_ok());
        assert!(store(&s3(), &url("az://container/x.csv")).is_err());
    }
}
