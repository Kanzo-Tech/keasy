use std::collections::HashMap;
use std::sync::Arc;

use object_store::aws::AmazonS3Builder;
use object_store::azure::MicrosoftAzureBuilder;
use object_store::gcp::GoogleCloudStorageBuilder;
use object_store::path::Path as ObjectPath;
use object_store::signer::Signer;
use object_store::ObjectStore;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize, Serializer};
use utoipa::ToSchema;

pub use object_store::path::Path;

// ── CloudStore ─────────────────────────────────────────────────────────

pub trait CloudStore: ObjectStore + Signer {}
impl<T: ObjectStore + Signer> CloudStore for T {}

// ── DuckDB SECRET projection ───────────────────────────────────────────

pub struct DuckDbSecretSpec {
    pub secret_type: &'static str,
    pub params: Vec<(&'static str, String)>,
}

// ── Serde helpers for SecretString ─────────────────────────────────────

fn expose_secret<S: Serializer>(secret: &SecretString, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(secret.expose_secret())
}

fn expose_secret_opt<S: Serializer>(
    secret: &Option<SecretString>,
    s: S,
) -> Result<S::Ok, S::Error> {
    match secret {
        Some(val) => s.serialize_str(val.expose_secret()),
        None => s.serialize_none(),
    }
}

// ── Connector enum ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectorConfig {
    /// AWS S3 bucket.
    S3 {
        /// Bucket name.
        #[schema(example = "my-data-bucket")]
        bucket: String,

        /// Optional key prefix to scope access within the bucket.
        #[schema(example = "data/raw/")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefix: Option<String>,

        /// AWS region where the bucket lives.
        #[schema(example = "eu-west-1")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<String>,

        /// Access Key ID. Leave empty for IAM role / default credential chain.
        #[schema(example = "AKIAIOSFODNN7EXAMPLE")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        access_key_id: Option<String>,

        /// Secret Access Key.
        #[schema(value_type = Option<String>, format = Password)]
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            serialize_with = "expose_secret_opt"
        )]
        secret_access_key: Option<SecretString>,

        /// Session Token for STS temporary credentials.
        #[schema(value_type = Option<String>, format = Password)]
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            serialize_with = "expose_secret_opt"
        )]
        session_token: Option<SecretString>,

        /// S3-compatible endpoint. Leave empty for AWS S3; set for MinIO, R2, Wasabi.
        #[schema(example = "https://s3.eu-west-1.amazonaws.com")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,

        /// URL addressing style: "vhost" (default for AWS) or "path" (default when endpoint is set).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url_style: Option<String>,
    },

    /// Google Cloud Storage bucket.
    ///
    /// Requires two credential forms because DuckDB and object_store
    /// speak different Google protocols: service_account_json for Rust
    /// (signing + reads), hmac_key_id+hmac_secret for DuckDB interop.
    Gcs {
        /// Bucket name.
        #[schema(example = "my-gcs-bucket")]
        bucket: String,

        /// Optional object prefix within the bucket.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefix: Option<String>,

        /// Service account JSON key. Used by object_store for URL signing.
        #[schema(value_type = Option<String>, format = Password)]
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            serialize_with = "expose_secret_opt"
        )]
        service_account_json: Option<SecretString>,

        /// HMAC key ID (generate in GCP Console → Interoperability).
        #[schema(example = "GOOG1EXAMPLE")]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hmac_key_id: Option<String>,

        /// HMAC secret paired with hmac_key_id.
        #[schema(value_type = Option<String>, format = Password)]
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            serialize_with = "expose_secret_opt"
        )]
        hmac_secret: Option<SecretString>,
    },

    /// Azure Blob Storage container.
    #[serde(rename = "azure_blob")]
    Azure {
        /// Container name.
        #[schema(example = "my-container")]
        container: String,

        /// Optional blob prefix within the container.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prefix: Option<String>,

        /// Azure Storage connection string (Portal → Access Keys → Connection string).
        #[schema(
            value_type = String,
            format = Password,
            example = "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k;EndpointSuffix=core.windows.net"
        )]
        #[serde(serialize_with = "expose_secret")]
        connection_string: SecretString,
    },
}

impl ConnectorConfig {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::S3 { .. } => "s3",
            Self::Gcs { .. } => "gcs",
            Self::Azure { .. } => "azure_blob",
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::S3 { bucket, .. } => {
                if bucket.is_empty() {
                    return Err("bucket is required".into());
                }
                Ok(())
            }
            Self::Gcs {
                bucket,
                service_account_json,
                hmac_key_id,
                hmac_secret,
                ..
            } => {
                if bucket.is_empty() {
                    return Err("bucket is required".into());
                }
                let has_sa = service_account_json.is_some();
                let has_hmac = hmac_key_id.is_some() && hmac_secret.is_some();
                if !has_sa && !has_hmac {
                    return Err(
                        "GCS connectors need at least one credential set: \
                         service_account_json (for URL signing) or \
                         hmac_key_id+hmac_secret (for DuckDB reads). \
                         For full functionality, provide both. \
                         See infra/README.md#gcs-dual-credentials."
                            .into(),
                    );
                }
                Ok(())
            }
            Self::Azure {
                container,
                connection_string,
                ..
            } => {
                if container.is_empty() {
                    return Err("container is required".into());
                }
                let parsed = AzureCs::parse(connection_string.expose_secret());
                if parsed.account_name.is_none() && parsed.blob_endpoint.is_none() {
                    return Err(
                        "connection_string must contain AccountName or BlobEndpoint".into(),
                    );
                }
                if parsed.account_key.is_none() && parsed.sas_token.is_none() {
                    return Err(
                        "connection_string must contain AccountKey or SharedAccessSignature"
                            .into(),
                    );
                }
                Ok(())
            }
        }
    }

    pub fn base_url(&self) -> String {
        match self {
            Self::S3 { bucket, prefix, .. } => {
                let base = format!("s3://{bucket}");
                match prefix.as_deref().filter(|s| !s.is_empty()) {
                    Some(p) => format!("{base}/{p}"),
                    None => base,
                }
            }
            Self::Gcs { bucket, prefix, .. } => {
                let base = format!("gs://{bucket}");
                match prefix.as_deref().filter(|s| !s.is_empty()) {
                    Some(p) => format!("{base}/{p}"),
                    None => base,
                }
            }
            Self::Azure {
                container, prefix, ..
            } => {
                let base = format!("az://{container}");
                match prefix.as_deref().filter(|s| !s.is_empty()) {
                    Some(p) => format!("{base}/{p}"),
                    None => base,
                }
            }
        }
    }

    pub fn build_store(&self) -> Result<(Arc<dyn CloudStore>, ObjectPath), String> {
        match self {
            Self::S3 {
                bucket,
                prefix,
                region,
                access_key_id,
                secret_access_key,
                session_token,
                endpoint,
                url_style,
            } => {
                let mut builder = AmazonS3Builder::new().with_bucket_name(bucket);
                if let Some(r) = region {
                    builder = builder.with_region(r);
                }
                if let Some(k) = access_key_id {
                    builder = builder.with_access_key_id(k);
                }
                if let Some(k) = secret_access_key {
                    builder = builder.with_secret_access_key(k.expose_secret());
                }
                if let Some(t) = session_token {
                    builder = builder.with_token(t.expose_secret());
                }
                if let Some(e) = endpoint {
                    builder = builder.with_endpoint(e);
                    if e.starts_with("http://") {
                        builder = builder.with_allow_http(true);
                    }
                }
                if matches!(url_style.as_deref(), Some("path")) {
                    builder = builder.with_virtual_hosted_style_request(false);
                }
                let store = builder
                    .build()
                    .map_err(|e| format!("S3 build failed: {e}"))?;
                let path = prefix
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .map(ObjectPath::from)
                    .unwrap_or_else(|| ObjectPath::from(""));
                Ok((Arc::new(store), path))
            }
            Self::Gcs {
                bucket,
                prefix,
                service_account_json,
                ..
            } => {
                let mut builder = GoogleCloudStorageBuilder::new().with_bucket_name(bucket);
                if let Some(sa) = service_account_json {
                    builder = builder.with_service_account_key(sa.expose_secret());
                }
                let store = builder
                    .build()
                    .map_err(|e| format!("GCS build failed: {e}"))?;
                let path = prefix
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .map(ObjectPath::from)
                    .unwrap_or_else(|| ObjectPath::from(""));
                Ok((Arc::new(store), path))
            }
            Self::Azure {
                container,
                prefix,
                connection_string,
            } => {
                let parsed = AzureCs::parse(connection_string.expose_secret());
                let mut builder = MicrosoftAzureBuilder::new().with_container_name(container);
                if let Some(account) = parsed.account_name {
                    builder = builder.with_account(account);
                }
                if let Some(key) = parsed.account_key {
                    builder = builder.with_access_key(key);
                }
                if let Some(sas) = parsed.sas_token {
                    let pairs: Vec<(String, String)> = sas
                        .trim_start_matches('?')
                        .split('&')
                        .filter_map(|kv| {
                            kv.split_once('=')
                                .map(|(k, v)| (k.to_string(), v.to_string()))
                        })
                        .collect();
                    builder = builder.with_sas_authorization(pairs);
                }
                if let Some(endpoint) = parsed.blob_endpoint {
                    builder = builder.with_endpoint(endpoint.to_string());
                }
                let store = builder
                    .build()
                    .map_err(|e| format!("Azure build failed: {e}"))?;
                let path = prefix
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .map(ObjectPath::from)
                    .unwrap_or_else(|| ObjectPath::from(""));
                Ok((Arc::new(store), path))
            }
        }
    }

    pub fn duckdb_secret(&self) -> DuckDbSecretSpec {
        match self {
            Self::S3 {
                access_key_id,
                secret_access_key,
                session_token,
                region,
                endpoint,
                url_style,
                ..
            } => {
                let mut params: Vec<(&'static str, String)> = Vec::new();
                if let Some(k) = access_key_id {
                    params.push(("KEY_ID", k.clone()));
                }
                if let Some(k) = secret_access_key {
                    params.push(("SECRET", k.expose_secret().to_string()));
                }
                if let Some(t) = session_token {
                    params.push(("SESSION_TOKEN", t.expose_secret().to_string()));
                }
                if let Some(r) = region {
                    params.push(("REGION", r.clone()));
                }
                if let Some(e) = endpoint {
                    let stripped = e
                        .trim_start_matches("https://")
                        .trim_start_matches("http://")
                        .trim_end_matches('/');
                    params.push(("ENDPOINT", stripped.into()));
                    if e.starts_with("http://") {
                        params.push(("USE_SSL", "false".into()));
                    }
                }
                let default_style = if endpoint.is_some() { "path" } else { "vhost" };
                let style = url_style.as_deref().unwrap_or(default_style);
                params.push(("URL_STYLE", style.into()));
                DuckDbSecretSpec {
                    secret_type: "s3",
                    params,
                }
            }
            Self::Gcs {
                hmac_key_id,
                hmac_secret,
                ..
            } => {
                let mut params: Vec<(&'static str, String)> = Vec::new();
                if let Some(k) = hmac_key_id {
                    params.push(("KEY_ID", k.clone()));
                }
                if let Some(s) = hmac_secret {
                    params.push(("SECRET", s.expose_secret().to_string()));
                }
                DuckDbSecretSpec {
                    secret_type: "gcs",
                    params,
                }
            }
            Self::Azure {
                connection_string, ..
            } => DuckDbSecretSpec {
                secret_type: "azure",
                params: vec![(
                    "CONNECTION_STRING",
                    connection_string.expose_secret().to_string(),
                )],
            },
        }
    }

    pub fn into_redacted(self) -> Self {
        match self {
            Self::S3 {
                bucket,
                prefix,
                region,
                access_key_id,
                endpoint,
                url_style,
                ..
            } => Self::S3 {
                bucket,
                prefix,
                region,
                access_key_id,
                secret_access_key: None,
                session_token: None,
                endpoint,
                url_style,
            },
            Self::Gcs {
                bucket, prefix, ..
            } => Self::Gcs {
                bucket,
                prefix,
                service_account_json: None,
                hmac_key_id: None,
                hmac_secret: None,
            },
            Self::Azure {
                container, prefix, ..
            } => Self::Azure {
                container,
                prefix,
                connection_string: SecretString::from(""),
            },
        }
    }

    /// Secret field names for this connector kind — used by the secrets module
    /// to split/merge/redact secrets for DB persistence.
    pub fn secret_field_names(&self) -> &'static [&'static str] {
        match self {
            Self::S3 { .. } => &["secret_access_key", "session_token"],
            Self::Gcs { .. } => &["service_account_json", "hmac_secret"],
            Self::Azure { .. } => &["connection_string"],
        }
    }
}

// ── ConnectorKindInfo (for kind selector endpoint) ─────────────────────

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ConnectorKindInfo {
    pub kind: &'static str,
    pub name: &'static str,
    pub description: &'static str,
}

pub const KNOWN_KINDS: &[ConnectorKindInfo] = &[
    ConnectorKindInfo {
        kind: "s3",
        name: "Amazon S3",
        description: "AWS S3 bucket",
    },
    ConnectorKindInfo {
        kind: "gcs",
        name: "Google Cloud Storage",
        description: "GCS bucket",
    },
    ConnectorKindInfo {
        kind: "azure_blob",
        name: "Azure Blob Storage",
        description: "Azure Blob container",
    },
];

// ── Azure connection string parser ─────────────────────────────────────

#[derive(Debug, Default)]
struct AzureCs<'a> {
    account_name: Option<&'a str>,
    account_key: Option<&'a str>,
    sas_token: Option<&'a str>,
    blob_endpoint: Option<&'a str>,
}

impl<'a> AzureCs<'a> {
    fn parse(cs: &'a str) -> Self {
        let pairs: HashMap<&str, &str> = cs
            .split(';')
            .filter(|s| !s.is_empty())
            .filter_map(|pair| pair.split_once('='))
            .map(|(k, v)| (k.trim(), v.trim()))
            .collect();

        Self {
            account_name: pairs.get("AccountName").copied(),
            account_key: pairs.get("AccountKey").copied(),
            sas_token: pairs.get("SharedAccessSignature").copied(),
            blob_endpoint: pairs.get("BlobEndpoint").copied(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Serde round-trip ───────────────────────────────────────────

    #[test]
    fn serde_roundtrip_s3() {
        let config = ConnectorConfig::S3 {
            bucket: "test".to_string(),
            prefix: None,
            region: Some("us-east-1".to_string()),
            access_key_id: Some("AKIA".to_string()),
            secret_access_key: Some(SecretString::from("secret")),
            session_token: None,
            endpoint: None,
            url_style: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains(r#""kind":"s3"#));
        assert!(json.contains("secret"));
        let parsed: ConnectorConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.kind(), "s3");
    }

    #[test]
    fn serde_roundtrip_azure() {
        let config = ConnectorConfig::Azure {
            container: "data".to_string(),
            prefix: None,
            connection_string: SecretString::from(
                "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k;EndpointSuffix=core.windows.net",
            ),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains(r#""kind":"azure_blob"#));
        let parsed: ConnectorConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.kind(), "azure_blob");
    }

    // ── Debug safety ───────────────────────────────────────────────

    #[test]
    fn debug_does_not_leak_secrets() {
        let config = ConnectorConfig::Azure {
            container: "data".to_string(),
            prefix: None,
            connection_string: SecretString::from("AccountKey=SUPER_SECRET"),
        };
        let debug = format!("{:?}", config);
        assert!(!debug.contains("SUPER_SECRET"));
    }

    // ── Azure parser ───────────────────────────────────────────────

    #[test]
    fn parses_shared_key_connection_string() {
        let cs = "DefaultEndpointsProtocol=https;AccountName=myacct;AccountKey=YWJjZA==;EndpointSuffix=core.windows.net";
        let p = AzureCs::parse(cs);
        assert_eq!(p.account_name, Some("myacct"));
        assert_eq!(p.account_key, Some("YWJjZA=="));
        assert_eq!(p.sas_token, None);
    }

    #[test]
    fn parses_sas_connection_string() {
        let cs = "BlobEndpoint=https://myacct.blob.core.windows.net;SharedAccessSignature=sv=2021-06-08&sig=xyz";
        let p = AzureCs::parse(cs);
        assert_eq!(
            p.blob_endpoint,
            Some("https://myacct.blob.core.windows.net")
        );
        assert_eq!(p.sas_token, Some("sv=2021-06-08&sig=xyz"));
        assert_eq!(p.account_key, None);
    }

    // ── Validation ─────────────────────────────────────────────────

    #[test]
    fn validate_s3_rejects_empty_bucket() {
        let config = ConnectorConfig::S3 {
            bucket: "".to_string(),
            prefix: None,
            region: None,
            access_key_id: None,
            secret_access_key: None,
            session_token: None,
            endpoint: None,
            url_style: None,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_gcs_rejects_empty_credentials() {
        let config = ConnectorConfig::Gcs {
            bucket: "b".to_string(),
            prefix: None,
            service_account_json: None,
            hmac_key_id: None,
            hmac_secret: None,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_gcs_accepts_hmac_only() {
        let config = ConnectorConfig::Gcs {
            bucket: "b".to_string(),
            prefix: None,
            service_account_json: None,
            hmac_key_id: Some("GOOG1".to_string()),
            hmac_secret: Some(SecretString::from("xyz")),
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_gcs_accepts_service_account_only() {
        let config = ConnectorConfig::Gcs {
            bucket: "b".to_string(),
            prefix: None,
            service_account_json: Some(SecretString::from(r#"{"type":"service_account"}"#)),
            hmac_key_id: None,
            hmac_secret: None,
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_gcs_rejects_partial_hmac() {
        let config = ConnectorConfig::Gcs {
            bucket: "b".to_string(),
            prefix: None,
            service_account_json: None,
            hmac_key_id: Some("GOOG1".to_string()),
            hmac_secret: None,
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_azure_rejects_empty_credentials() {
        let config = ConnectorConfig::Azure {
            container: "data".to_string(),
            prefix: None,
            connection_string: SecretString::from(
                "DefaultEndpointsProtocol=https;EndpointSuffix=core.windows.net",
            ),
        };
        assert!(config.validate().is_err());
    }

    // ── DuckDB SECRET ──────────────────────────────────────────────

    #[test]
    fn duckdb_secret_s3_includes_session_token() {
        let config = ConnectorConfig::S3 {
            bucket: "b".to_string(),
            prefix: None,
            region: Some("us-east-1".to_string()),
            access_key_id: Some("AKIA".to_string()),
            secret_access_key: Some(SecretString::from("xxx")),
            session_token: Some(SecretString::from("FwoGZXIvYXdz...")),
            endpoint: None,
            url_style: None,
        };
        let spec = config.duckdb_secret();
        assert_eq!(spec.secret_type, "s3");
        let names: Vec<&str> = spec.params.iter().map(|(k, _)| *k).collect();
        assert!(names.contains(&"KEY_ID"));
        assert!(names.contains(&"SECRET"));
        assert!(names.contains(&"SESSION_TOKEN"));
        assert!(names.contains(&"REGION"));
    }

    #[test]
    fn duckdb_secret_s3_defaults_to_path_style_for_custom_endpoint() {
        let config = ConnectorConfig::S3 {
            bucket: "b".to_string(),
            prefix: None,
            region: None,
            access_key_id: Some("k".to_string()),
            secret_access_key: Some(SecretString::from("s")),
            session_token: None,
            endpoint: Some("http://minio:9000".to_string()),
            url_style: None,
        };
        let spec = config.duckdb_secret();
        let url_style = spec.params.iter().find(|(k, _)| *k == "URL_STYLE").unwrap();
        assert_eq!(url_style.1, "path");
        assert!(spec
            .params
            .iter()
            .any(|(k, v)| *k == "USE_SSL" && v == "false"));
    }

    #[test]
    fn duckdb_secret_azure_passthrough() {
        let cs = "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k;EndpointSuffix=core.windows.net";
        let config = ConnectorConfig::Azure {
            container: "data".to_string(),
            prefix: None,
            connection_string: SecretString::from(cs),
        };
        let spec = config.duckdb_secret();
        assert_eq!(spec.secret_type, "azure");
        assert_eq!(spec.params.len(), 1);
        assert_eq!(spec.params[0].0, "CONNECTION_STRING");
        assert_eq!(spec.params[0].1, cs);
    }

    // ── OpenAPI schema ─────────────────────────────────────────────

    #[test]
    fn openapi_generates_oneof_with_password_format() {
        use utoipa::OpenApi;

        #[derive(OpenApi)]
        #[openapi(components(schemas(ConnectorConfig)))]
        struct TestApi;

        let doc = TestApi::openapi();
        let json = serde_json::to_string_pretty(&doc).unwrap();
        let spec: serde_json::Value = serde_json::from_str(&json).unwrap();
        let connector = &spec["components"]["schemas"]["ConnectorConfig"];

        assert!(connector.get("oneOf").is_some());
        let variants = connector["oneOf"].as_array().unwrap();
        assert_eq!(variants.len(), 3);

        assert!(json.contains("password"));

        // Each variant has kind as enum discriminator
        for variant in variants {
            assert!(variant["properties"]["kind"].get("enum").is_some());
        }
    }
}
