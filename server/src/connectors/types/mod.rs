//! ConnectorType trait and registry.
//!
//! Each storage backend implements ConnectorType. Adding a new backend
//! = implementing the trait, NOT editing a match statement.
//!
//! Reference: DataFusion ObjectStoreRegistry, Airbyte connector pattern.

pub mod azure;
pub mod gcs;
pub mod s3;

use std::collections::HashMap;
use std::sync::Arc;

use object_store::path::Path as ObjectPath;
use object_store::signer::Signer;
use object_store::ObjectStore;
use serde::Serialize;

use super::models::ConnectorDirection;

// Re-exports so consumers can `use crate::connectors::types::{CloudStore, ObjectPath, ...}`
// without depending on `object_store::*` directly.
pub use object_store::path::Path;

// ── Helpers ────────────────────────────────────────────────────────────

/// Extract a non-empty string field from a JSON config object.
pub fn str_field<'a>(config: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    config.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}

// ── CloudStore ─────────────────────────────────────────────────────────

/// Combined trait: ObjectStore + Signer + Send + Sync.
///
/// `Arc<dyn CloudStore>` is keasy's canonical handle for talking to cloud
/// storage — it covers reading, writing, listing, AND URL signing in one
/// type. The blanket impl ties it to any `object_store` backend that also
/// implements `Signer` (S3, GCS, Azure — but not local FS, which is why
/// keasy is cloud-only). Compile-time guarantee: every connector keasy
/// supports can do everything keasy needs.
pub trait CloudStore: ObjectStore + Signer {}
impl<T: ObjectStore + Signer> CloudStore for T {}

// ── DuckDB SECRET projection ───────────────────────────────────────────

/// Spec for `CREATE SECRET` in DuckDB: the secret type and parameters.
/// SCOPE is supplied by the caller (typically `entry.base_url`).
///
/// DuckDB is the only consumer of credentials that lives outside the
/// object_store ecosystem and needs its own credential format, so it
/// gets its own projection method on `ConnectorType`.
pub struct DuckDbSecretSpec {
    pub secret_type: &'static str,
    pub params: Vec<(&'static str, String)>,
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

/// Trait that each cloud storage backend implements.
pub trait ConnectorType: Send + Sync {
    fn info(&self) -> ConnectorTypeInfo;

    /// Validate config before saving.
    fn validate(&self, config: &serde_json::Value) -> Result<(), String>;

    /// Derive the base URL from config (e.g. `s3://bucket/prefix`).
    /// Used as the DuckDB SECRET SCOPE and as the prefix that
    /// `KeasyPathResolver` concatenates with `@conn/...` paths.
    fn base_url(&self, config: &serde_json::Value) -> String;

    /// Build the object_store client for this connector. The returned
    /// `Arc<dyn CloudStore>` is the canonical handle for read/write/sign
    /// operations and is shared across the job lifecycle.
    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(Arc<dyn CloudStore>, ObjectPath), String>;

    /// Project credentials to DuckDB SECRET parameters. Each impl knows
    /// the DuckDB key names for its cloud (KEY_ID / SECRET / REGION for
    /// S3, KEY_ID / SECRET for GCS HMAC, ACCOUNT_NAME / ACCOUNT_KEY for
    /// Azure, etc.). The caller installs the secret with `entry.base_url`
    /// as the SCOPE.
    fn duckdb_secret(&self, config: &serde_json::Value) -> DuckDbSecretSpec;
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
