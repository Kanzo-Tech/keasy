pub mod models;
pub mod errors;
pub mod db;
pub mod routes;
pub mod reader;

use std::collections::HashMap;
use std::time::Duration;

use futures::stream::BoxStream;
use http::Method;
use object_store::aws::{AmazonS3, AmazonS3Builder, AmazonS3ConfigKey};
use object_store::azure::{AzureConfigKey, MicrosoftAzure, MicrosoftAzureBuilder};
use object_store::gcp::{GoogleCloudStorage, GoogleCloudStorageBuilder, GoogleConfigKey};
use object_store::path::Path as ObjectPath;
use object_store::signer::Signer;
use object_store::{GetResult, ObjectMeta, ObjectStore, PutPayload, PutResult};
use url::Url;

use crate::settings::schema::{all_cloud_schemes, find_provider_by_scheme};

pub fn is_cloud_url(s: &str) -> bool {
    all_cloud_schemes().any(|scheme| s.starts_with(scheme) && s[scheme.len()..].starts_with("://"))
}

pub fn is_data_path(s: &str) -> bool {
    is_cloud_url(s) || s.starts_with('/') || s.starts_with("./") || s.starts_with("../")
}

/// Parse a cloud URL into its components (bucket, object path, provider).
pub(crate) fn parse_cloud_url(url_str: &str) -> Result<(String, ObjectPath, &'static crate::settings::schema::ProviderSchema), Box<dyn std::error::Error + Send + Sync>> {
    let parsed = url::Url::parse(url_str)?;

    let bucket = parsed
        .host_str()
        .ok_or_else(|| format!("cloud URL missing bucket/container: {url_str}"))?
        .to_string();

    let object_key = parsed.path().strip_prefix('/').unwrap_or(parsed.path());
    let path = if object_key.is_empty() {
        ObjectPath::from("")
    } else {
        ObjectPath::parse(object_key)?
    };

    let provider = find_provider_by_scheme(parsed.scheme())
        .ok_or_else(|| format!("unsupported cloud scheme: {}://", parsed.scheme()))?;

    Ok((bucket, path, provider))
}

/// Apply cloud account credentials to an object_store builder.
macro_rules! apply_creds {
    ($builder:expr, $key_type:ty, $fields:expr, $creds:expr) => {{
        let mut b = $builder;
        for field in $fields {
            if let (Some(ev), Some(ck)) = (field.env_var, field.store_config_key) {
                if let Some(v) = $creds.get(ev) {
                    b = b.with_config(ck.parse::<$key_type>().unwrap(), v);
                }
            }
        }
        b
    }};
}

// ── CloudStore: typed enum preserving provider for signing ───────────────

/// Cloud storage abstraction that preserves the concrete provider type.
/// Unlike `Box<dyn ObjectStore>`, this allows URL signing for direct
/// browser access to cloud storage.
pub enum CloudStore {
    Azure(MicrosoftAzure),
    S3(AmazonS3),
    Gcs(GoogleCloudStorage),
}

impl CloudStore {
    /// Generate a signed URL for temporary direct access to a cloud object.
    /// The URL expires after `expires_in`. Azure SAS tokens with `Method::GET`
    /// grant read permission (`r`) which allows both GET and HEAD.
    pub async fn sign_url(
        &self,
        method: Method,
        path: &ObjectPath,
        expires_in: Duration,
    ) -> object_store::Result<Url> {
        match self {
            Self::Azure(s) => s.signed_url(method, path, expires_in).await,
            Self::S3(s) => s.signed_url(method, path, expires_in).await,
            Self::Gcs(s) => s.signed_url(method, path, expires_in).await,
        }
    }

    /// Batch-sign multiple URLs. Uses the Signer::signed_urls default
    /// which signs sequentially, but providers may optimize internally.
    pub async fn sign_urls(
        &self,
        method: Method,
        paths: &[ObjectPath],
        expires_in: Duration,
    ) -> object_store::Result<Vec<Url>> {
        match self {
            Self::Azure(s) => s.signed_urls(method, paths, expires_in).await,
            Self::S3(s) => s.signed_urls(method, paths, expires_in).await,
            Self::Gcs(s) => s.signed_urls(method, paths, expires_in).await,
        }
    }

    // ── Delegate ObjectStore operations ──

    pub async fn head(&self, path: &ObjectPath) -> object_store::Result<ObjectMeta> {
        match self {
            Self::Azure(s) => s.head(path).await,
            Self::S3(s) => s.head(path).await,
            Self::Gcs(s) => s.head(path).await,
        }
    }

    pub async fn get(&self, path: &ObjectPath) -> object_store::Result<GetResult> {
        match self {
            Self::Azure(s) => s.get(path).await,
            Self::S3(s) => s.get(path).await,
            Self::Gcs(s) => s.get(path).await,
        }
    }

pub async fn put(
        &self,
        path: &ObjectPath,
        payload: PutPayload,
    ) -> object_store::Result<PutResult> {
        match self {
            Self::Azure(s) => s.put(path, payload).await,
            Self::S3(s) => s.put(path, payload).await,
            Self::Gcs(s) => s.put(path, payload).await,
        }
    }

    pub fn list(&self, prefix: Option<&ObjectPath>) -> BoxStream<'_, object_store::Result<ObjectMeta>> {
        match self {
            Self::Azure(s) => s.list(prefix),
            Self::S3(s) => s.list(prefix),
            Self::Gcs(s) => s.list(prefix),
        }
    }

    /// List one level under `prefix`: `common_prefixes` are the immediate
    /// "subdirectories" (used by the orphan sweep to enumerate per-job prefixes
    /// under the substrate without walking every object).
    pub async fn list_with_delimiter(
        &self,
        prefix: Option<&ObjectPath>,
    ) -> object_store::Result<object_store::ListResult> {
        match self {
            Self::Azure(s) => s.list_with_delimiter(prefix).await,
            Self::S3(s) => s.list_with_delimiter(prefix).await,
            Self::Gcs(s) => s.list_with_delimiter(prefix).await,
        }
    }

    pub async fn delete(&self, path: &ObjectPath) -> object_store::Result<()> {
        match self {
            Self::Azure(s) => s.delete(path).await,
            Self::S3(s) => s.delete(path).await,
            Self::Gcs(s) => s.delete(path).await,
        }
    }
}

/// Build a cloud store from a URL and credentials.
pub fn build_store(
    url_str: &str,
    creds: &HashMap<String, String>,
) -> Result<(CloudStore, ObjectPath), Box<dyn std::error::Error + Send + Sync>> {
    let (bucket, path, provider) = parse_cloud_url(url_str)?;
    let fields = provider.all_fields();

    let store = match provider.id {
        "azure" => CloudStore::Azure(apply_creds!(
            MicrosoftAzureBuilder::new().with_container_name(&bucket),
            AzureConfigKey, &fields, creds
        ).build()?),
        "s3" => CloudStore::S3(apply_creds!(
            AmazonS3Builder::new().with_bucket_name(&bucket),
            AmazonS3ConfigKey, &fields, creds
        ).build()?),
        "gcp" => CloudStore::Gcs(apply_creds!(
            GoogleCloudStorageBuilder::new().with_bucket_name(&bucket),
            GoogleConfigKey, &fields, creds
        ).build()?),
        _ => return Err(format!("no builder for provider: {}", provider.id).into()),
    };

    Ok((store, path))
}
