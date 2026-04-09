use object_store::gcp::{GoogleCloudStorage, GoogleCloudStorageBuilder};
use object_store::path::Path as ObjectPath;
use super::{str_field, CloudStore, ConnectorDirection, ConnectorType, ConnectorTypeInfo};

pub struct GcsConnector;

fn build_gcs(config: &serde_json::Value) -> Result<(GoogleCloudStorage, ObjectPath), String> {
    let bucket = str_field(config, "bucket").ok_or("bucket required")?;
    let prefix = str_field(config, "prefix").unwrap_or("");

    let mut builder = GoogleCloudStorageBuilder::new().with_bucket_name(bucket);
    if let Some(sa) = str_field(config, "service_account_json") {
        builder = builder.with_service_account_key(sa);
    }

    let store = builder.build().map_err(|e| format!("GCS build failed: {e}"))?;
    let path = if prefix.is_empty() {
        ObjectPath::from("")
    } else {
        ObjectPath::from(prefix)
    };
    Ok((store, path))
}

impl ConnectorType for GcsConnector {
    fn info(&self) -> ConnectorTypeInfo {
        ConnectorTypeInfo {
            id: "gcs",
            name: "Google Cloud Storage",
            description: "GCS bucket",
            direction: ConnectorDirection::Both,
            secret_fields: &["service_account_json"],
        }
    }

    fn validate(&self, config: &serde_json::Value) -> Result<(), String> {
        str_field(config, "bucket").ok_or("bucket is required")?;
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

    fn cloud_config(&self, config: &serde_json::Value) -> Option<Vec<(String, String)>> {
        let mut pairs: Vec<(String, String)> = vec![];
        if let Some(sa) = str_field(config, "service_account_json") { pairs.push(("google_service_account".into(), sa.into())); }
        if pairs.is_empty() { return None; }
        Some(pairs)
    }

    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(CloudStore, ObjectPath), String> {
        let (store, path) = build_gcs(config)?;
        Ok((CloudStore::Gcs(store), path))
    }
}
