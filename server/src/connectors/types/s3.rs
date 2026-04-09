use object_store::aws::{AmazonS3, AmazonS3Builder};
use object_store::path::Path as ObjectPath;
use super::{str_field, CloudStore, ConnectorDirection, ConnectorType, ConnectorTypeInfo};

pub struct S3Connector;

fn build_s3(config: &serde_json::Value) -> Result<(AmazonS3, ObjectPath), String> {
    let bucket = str_field(config, "bucket").ok_or("bucket required")?;
    let prefix = str_field(config, "prefix").unwrap_or("");

    let mut builder = AmazonS3Builder::new().with_bucket_name(bucket);
    if let Some(r) = str_field(config, "region") {
        builder = builder.with_region(r);
    }
    if let Some(k) = str_field(config, "access_key_id") {
        builder = builder.with_access_key_id(k);
    }
    if let Some(k) = str_field(config, "secret_access_key") {
        builder = builder.with_secret_access_key(k);
    }
    if let Some(e) = str_field(config, "endpoint") {
        builder = builder.with_endpoint(e);
    }

    let store = builder.build().map_err(|e| format!("S3 build failed: {e}"))?;
    let path = if prefix.is_empty() {
        ObjectPath::from("")
    } else {
        ObjectPath::from(prefix)
    };
    Ok((store, path))
}

impl ConnectorType for S3Connector {
    fn info(&self) -> ConnectorTypeInfo {
        ConnectorTypeInfo {
            id: "s3",
            name: "Amazon S3",
            description: "AWS S3 bucket",
            direction: ConnectorDirection::Both,
            secret_fields: &["access_key_id", "secret_access_key"],
        }
    }

    fn validate(&self, config: &serde_json::Value) -> Result<(), String> {
        str_field(config, "bucket").ok_or("bucket is required")?;
        Ok(())
    }

    fn base_url(&self, config: &serde_json::Value) -> String {
        let bucket = str_field(config, "bucket").unwrap_or("");
        let prefix = str_field(config, "prefix").unwrap_or("");
        let endpoint = str_field(config, "endpoint");
        let base = if let Some(ep) = endpoint {
            format!("{ep}/{bucket}")
        } else {
            format!("s3://{bucket}")
        };
        if prefix.is_empty() {
            base
        } else {
            format!("{base}/{prefix}")
        }
    }

    fn cloud_config(&self, config: &serde_json::Value) -> Option<Vec<(String, String)>> {
        let mut pairs: Vec<(String, String)> = vec![];
        if let Some(k) = str_field(config, "access_key_id") { pairs.push(("aws_access_key_id".into(), k.into())); }
        if let Some(k) = str_field(config, "secret_access_key") { pairs.push(("aws_secret_access_key".into(), k.into())); }
        if let Some(r) = str_field(config, "region") { pairs.push(("aws_default_region".into(), r.into())); }
        if let Some(e) = str_field(config, "endpoint") { pairs.push(("aws_endpoint_url".into(), e.into())); }
        if pairs.is_empty() { return None; }
        Some(pairs)
    }

    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(CloudStore, ObjectPath), String> {
        let (store, path) = build_s3(config)?;
        Ok((CloudStore::S3(store), path))
    }
}
