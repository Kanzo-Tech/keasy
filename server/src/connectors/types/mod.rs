//! ConnectorType trait and registry.
//!
//! Each storage backend implements ConnectorType. Adding a new backend
//! = implementing the trait, NOT editing a match statement.
//!
//! Reference: DataFusion ObjectStoreRegistry, Airbyte connector pattern,
//! Fossil TypeProviderImpl.

pub mod azure;
pub mod gcs;
pub mod local_fs;
pub mod s3;

use std::collections::HashMap;
use std::sync::Arc;

use std::time::Duration;

use futures::stream::BoxStream;
use http::Method;
use object_store::aws::AmazonS3;
use object_store::azure::MicrosoftAzure;
use object_store::gcp::GoogleCloudStorage;
use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjectPath;
use object_store::signer::Signer;
use object_store::{ObjectMeta, ObjectStore, PutPayload, PutResult};
use serde::Serialize;
use url::Url;

use super::models::ConnectorDirection;

// ── Helpers ────────────────────────────────────────────────────────────

/// Extract a non-empty string field from a JSON config object.
pub fn str_field<'a>(config: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    config.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}

// ── CloudStore ─────────────────────────────────────────────────────────

/// Cloud storage abstraction that preserves the concrete provider type.
/// Unlike `Box<dyn ObjectStore>`, this allows URL signing for direct
/// browser access to cloud storage.
pub enum CloudStore {
    S3(AmazonS3),
    Azure(MicrosoftAzure),
    Gcs(GoogleCloudStorage),
    Local(LocalFileSystem),
}

impl CloudStore {
    fn as_store(&self) -> &dyn ObjectStore {
        match self {
            Self::S3(s) => s,
            Self::Azure(s) => s,
            Self::Gcs(s) => s,
            Self::Local(s) => s,
        }
    }

    /// Batch-sign multiple URLs. Only cloud variants support signing.
    pub async fn sign_urls(
        &self,
        method: Method,
        paths: &[ObjectPath],
        expires_in: Duration,
    ) -> object_store::Result<Vec<Url>> {
        match self {
            Self::S3(s) => s.signed_urls(method, paths, expires_in).await,
            Self::Azure(s) => s.signed_urls(method, paths, expires_in).await,
            Self::Gcs(s) => s.signed_urls(method, paths, expires_in).await,
            Self::Local(_) => Err(object_store::Error::NotSupported {
                source: "local filesystem does not support URL signing".into(),
            }),
        }
    }

    pub fn list(&self, prefix: Option<&ObjectPath>) -> BoxStream<'_, object_store::Result<ObjectMeta>> {
        self.as_store().list(prefix)
    }

    pub async fn put(&self, path: &ObjectPath, payload: PutPayload) -> object_store::Result<PutResult> {
        self.as_store().put(path, payload).await
    }
}

// ── ConnectorType trait ────────────────────────────────────────────────

/// Metadata about a connector type (for API listing).
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ConnectorTypeInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub direction: ConnectorDirection,
    pub secret_fields: &'static [&'static str],
}

/// Trait that each storage backend implements.
pub trait ConnectorType: Send + Sync {
    fn info(&self) -> ConnectorTypeInfo;

    /// Validate config before saving.
    fn validate(&self, config: &serde_json::Value) -> Result<(), String>;

    /// Derive the base URL from config (e.g. `s3://bucket/prefix`).
    fn base_url(&self, config: &serde_json::Value) -> String;

    /// Build cloud configuration key-value pairs from connector config.
    /// Returns raw pairs consumed by the DuckDB execution engine.
    fn cloud_config(&self, config: &serde_json::Value) -> Option<Vec<(String, String)>> {
        let _ = config;
        None
    }

    /// Build a CloudStore client for file operations.
    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(CloudStore, ObjectPath), String>;
}

/// Registry of available connector types.
pub struct ConnectorRegistry {
    types: HashMap<&'static str, Arc<dyn ConnectorType>>,
}

impl ConnectorRegistry {
    pub fn new() -> Self {
        Self {
            types: HashMap::new(),
        }
    }

    pub fn register(&mut self, id: &'static str, ct: Arc<dyn ConnectorType>) {
        self.types.insert(id, ct);
    }

    pub fn get(&self, type_id: &str) -> Option<&Arc<dyn ConnectorType>> {
        self.types.get(type_id)
    }

    pub fn list(&self) -> Vec<ConnectorTypeInfo> {
        self.types.values().map(|ct| ct.info()).collect()
    }
}
