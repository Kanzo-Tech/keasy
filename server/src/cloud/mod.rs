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
        }
    }

    // ── Delegate ObjectStore operations ──

    pub async fn head(&self, path: &ObjectPath) -> object_store::Result<ObjectMeta> {
        match self {
            Self::Azure(s) => s.head(path).await,
            Self::S3(s) => s.head(path).await,
        }
    }

    pub async fn get(&self, path: &ObjectPath) -> object_store::Result<GetResult> {
        match self {
            Self::Azure(s) => s.get(path).await,
            Self::S3(s) => s.get(path).await,
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
        }
    }

    pub fn list(&self, prefix: Option<&ObjectPath>) -> BoxStream<'_, object_store::Result<ObjectMeta>> {
        match self {
            Self::Azure(s) => s.list(prefix),
            Self::S3(s) => s.list(prefix),
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
        "s3" => {
            let mut builder = AmazonS3Builder::new().with_bucket_name(&bucket);

            // S3-compatible stores used in local development (for example
            // MinIO) commonly expose an HTTP endpoint. object_store rejects
            // clear-text endpoints unless they are explicitly enabled on the
            // builder. This is intentionally scoped to a configured http://
            // endpoint; AWS S3 and HTTPS-compatible endpoints stay unchanged.
            //
            // Debug builds only (same dev/prod split as CORS and rate limiting
            // in `routes`): release builds keep object_store's default and
            // refuse clear-text endpoints, so production always talks TLS.
            if cfg!(debug_assertions)
                && creds
                    .get("AWS_ENDPOINT_URL")
                    .is_some_and(|endpoint| endpoint.starts_with("http://"))
            {
                builder = builder.with_allow_http(true);
            }

            CloudStore::S3(apply_creds!(builder, AmazonS3ConfigKey, &fields, creds).build()?)
        }
        _ => return Err(format!("no builder for provider: {}", provider.id).into()),
    };

    Ok((store, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_s3_compatible_store_with_http_endpoint() {
        let creds = HashMap::from([
            (
                "AWS_ACCESS_KEY_ID".to_string(),
                "test-access-key".to_string(),
            ),
            (
                "AWS_SECRET_ACCESS_KEY".to_string(),
                "test-secret-key".to_string(),
            ),
            ("AWS_DEFAULT_REGION".to_string(), "us-east-1".to_string()),
            (
                "AWS_ENDPOINT_URL".to_string(),
                "http://minio:9000".to_string(),
            ),
        ]);

        if let Err(error) = build_store("s3://connector-test/", &creds) {
            panic!("HTTP S3-compatible endpoints must be explicitly allowed: {error}");
        }
    }

    /// `http://` endpoints reach the network only in debug builds.
    ///
    /// `build()` succeeds either way: object_store refuses a clear-text
    /// endpoint only when it is about to send a request. So this test starts a
    /// tiny local HTTP server that answers 404 and sends it one request:
    /// - debug build (`make dev`, `make test-minio`, CI): the request reaches
    ///   the server, which answers 404 (`NotFound`);
    /// - release build (production): object_store refuses it before sending.
    ///
    /// Check the release side without a full release build:
    /// `cargo test --lib cloud::tests --config 'profile.dev.package.keasy-server.debug-assertions=false'`
    #[tokio::test]
    async fn http_endpoints_are_debug_only() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let n = socket.read(&mut buf).await.unwrap();
            assert!(n > 0, "the request reached the fake server");
            socket
                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });

        let endpoint = format!("http://{addr}");
        let creds: HashMap<String, String> = [
            ("AWS_ACCESS_KEY_ID", "test-access-key"),
            ("AWS_SECRET_ACCESS_KEY", "test-secret-key"),
            ("AWS_DEFAULT_REGION", "us-east-1"),
            ("AWS_ENDPOINT_URL", endpoint.as_str()),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

        let url = "s3://connector-test/probe.txt";
        let (store, path) = build_store(url, &creds).expect("store builds");
        let err = store.head(&path).await.expect_err("no 200 here");

        if cfg!(debug_assertions) {
            assert!(
                matches!(err, object_store::Error::NotFound { .. }),
                "debug build: the request must reach the endpoint, got {err}"
            );
            server.await.expect("the fake server received the request");
        } else {
            assert!(
                !matches!(err, object_store::Error::NotFound { .. }),
                "release build: clear-text endpoints must be refused, got {err}"
            );
            server.abort();
        }
    }
}
