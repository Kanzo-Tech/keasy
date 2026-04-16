use std::sync::Arc;

use object_store::gcp::GoogleCloudStorageBuilder;
use object_store::path::Path as ObjectPath;

use super::{
    str_field, CloudStore, ConnectorDirection, ConnectorType, ConnectorTypeInfo, DuckDbSecretSpec,
};

/// Google Cloud Storage connector.
///
/// # Credential model: two credentials per connection
///
/// Unlike S3 and Azure, GCS requires **two separate credential forms**
/// because DuckDB and `object_store` speak different Google protocols:
///
/// * `service_account_json` — Google's native OAuth2 credential format.
///   Used by `object_store::GoogleCloudStorageBuilder::with_service_account_key`
///   for URL signing (browser data plane) and Rust-side reads.
/// * `hmac_key_id` + `hmac_secret` — S3-interop HMAC keys. Used by
///   DuckDB's `CREATE SECRET TYPE gcs`, which does not accept service
///   account JSON natively (tracked in DuckDB discussion #15381).
///
/// This mirrors Rill Data's GCS driver verbatim
/// ([`runtime/drivers/gcs/gcs.go`](https://github.com/rilldata/rill/blob/main/runtime/drivers/gcs/gcs.go))
/// which stores `google_application_credentials` + `key_id` + `secret`
/// with an explicit comment about "S3-compatible mode for DuckDB".
///
/// Operators generate HMAC keys in the GCP Console under
/// **Settings → Interoperability → Access keys for service accounts**.
/// See `infra/README.md` for step-by-step instructions.
///
/// # Validation
///
/// At least one credential form must be present. The connector is
/// accepted with only HMAC (DuckDB-only usage), only service account
/// JSON (signing-only usage), or both (full functionality).
///
/// Refs:
/// * <https://github.com/duckdb/duckdb/discussions/15381> — DuckDB GCS
///   service account JSON support tracking
/// * <https://cloud.google.com/storage/docs/authentication/hmackeys>
///   — HMAC key generation
pub struct GcsConnector;

impl ConnectorType for GcsConnector {
    fn info(&self) -> ConnectorTypeInfo {
        ConnectorTypeInfo {
            id: "gcs",
            name: "Google Cloud Storage",
            description: "GCS bucket",
            direction: ConnectorDirection::Both,
            secret_fields: &["service_account_json", "hmac_key_id", "hmac_secret"],
        }
    }

    fn validate(&self, config: &serde_json::Value) -> Result<(), String> {
        str_field(config, "bucket").ok_or("bucket is required")?;
        let has_sa = str_field(config, "service_account_json").is_some();
        let has_hmac = str_field(config, "hmac_key_id").is_some()
            && str_field(config, "hmac_secret").is_some();
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

    fn base_url(&self, config: &serde_json::Value) -> String {
        let bucket = str_field(config, "bucket").unwrap_or("");
        let prefix = str_field(config, "prefix").unwrap_or("");
        if prefix.is_empty() {
            format!("gs://{bucket}")
        } else {
            format!("gs://{bucket}/{prefix}")
        }
    }

    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(Arc<dyn CloudStore>, ObjectPath), String> {
        let bucket = str_field(config, "bucket").ok_or("bucket required")?;
        let prefix = str_field(config, "prefix").unwrap_or("");

        let mut builder = GoogleCloudStorageBuilder::new().with_bucket_name(bucket);
        if let Some(sa) = str_field(config, "service_account_json") {
            builder = builder.with_service_account_key(sa);
        }

        let store = builder
            .build()
            .map_err(|e| format!("GCS build failed: {e}"))?;
        let path = if prefix.is_empty() {
            ObjectPath::from("")
        } else {
            ObjectPath::from(prefix)
        };
        Ok((Arc::new(store), path))
    }

    fn duckdb_secret(&self, config: &serde_json::Value) -> DuckDbSecretSpec {
        // DuckDB's gcs SECRET takes HMAC interop credentials only.
        // Service account JSON, if present, is used exclusively by
        // object_store for URL signing and Rust-side reads.
        let mut params: Vec<(&'static str, String)> = Vec::new();
        if let Some(k) = str_field(config, "hmac_key_id") {
            params.push(("KEY_ID", k.into()));
        }
        if let Some(s) = str_field(config, "hmac_secret") {
            params.push(("SECRET", s.into()));
        }
        DuckDbSecretSpec {
            secret_type: "gcs",
            params,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_hmac_only() {
        let conn = GcsConnector;
        let config = serde_json::json!({
            "bucket": "my-bucket",
            "hmac_key_id": "GOOG1ABC",
            "hmac_secret": "xyz",
        });
        assert!(conn.validate(&config).is_ok());
    }

    #[test]
    fn validate_accepts_service_account_only() {
        let conn = GcsConnector;
        let config = serde_json::json!({
            "bucket": "my-bucket",
            "service_account_json": "{\"type\":\"service_account\"}",
        });
        assert!(conn.validate(&config).is_ok());
    }

    #[test]
    fn validate_rejects_empty_credentials() {
        let conn = GcsConnector;
        let config = serde_json::json!({ "bucket": "my-bucket" });
        assert!(conn.validate(&config).is_err());
    }

    #[test]
    fn validate_rejects_partial_hmac() {
        let conn = GcsConnector;
        let config = serde_json::json!({
            "bucket": "my-bucket",
            "hmac_key_id": "GOOG1ABC",
            // missing hmac_secret
        });
        assert!(conn.validate(&config).is_err());
    }
}
