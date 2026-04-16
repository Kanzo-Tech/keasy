use std::sync::Arc;

use object_store::aws::AmazonS3Builder;
use object_store::path::Path as ObjectPath;

use super::{
    str_field, CloudStore, ConnectorDirection, ConnectorType, ConnectorTypeInfo, DuckDbSecretSpec,
};

pub struct S3Connector;

impl ConnectorType for S3Connector {
    fn info(&self) -> ConnectorTypeInfo {
        ConnectorTypeInfo {
            id: "s3",
            name: "Amazon S3",
            description: "AWS S3 bucket",
            direction: ConnectorDirection::Both,
            secret_fields: &["access_key_id", "secret_access_key", "session_token"],
        }
    }

    fn validate(&self, config: &serde_json::Value) -> Result<(), String> {
        str_field(config, "bucket").ok_or("bucket is required")?;
        Ok(())
    }

    fn base_url(&self, config: &serde_json::Value) -> String {
        let bucket = str_field(config, "bucket").unwrap_or("");
        let prefix = str_field(config, "prefix").unwrap_or("");
        let base = format!("s3://{bucket}");
        if prefix.is_empty() {
            base
        } else {
            format!("{base}/{prefix}")
        }
    }

    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(Arc<dyn CloudStore>, ObjectPath), String> {
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
        if let Some(t) = str_field(config, "session_token") {
            builder = builder.with_token(t);
        }
        if let Some(e) = str_field(config, "endpoint") {
            builder = builder.with_endpoint(e);
            // Custom endpoints (MinIO, R2, etc.) usually need path-style and
            // plain HTTP. Object_store rejects http:// without an opt-in flag.
            if e.starts_with("http://") {
                builder = builder.with_allow_http(true);
            }
        }
        if matches!(str_field(config, "url_style"), Some("path")) {
            builder = builder.with_virtual_hosted_style_request(false);
        }

        let store = builder
            .build()
            .map_err(|e| format!("S3 build failed: {e}"))?;
        let path = if prefix.is_empty() {
            ObjectPath::from("")
        } else {
            ObjectPath::from(prefix)
        };
        Ok((Arc::new(store), path))
    }

    fn duckdb_secret(&self, config: &serde_json::Value) -> DuckDbSecretSpec {
        let mut params: Vec<(&'static str, String)> = Vec::new();
        if let Some(k) = str_field(config, "access_key_id") {
            params.push(("KEY_ID", k.into()));
        }
        if let Some(k) = str_field(config, "secret_access_key") {
            params.push(("SECRET", k.into()));
        }
        if let Some(t) = str_field(config, "session_token") {
            params.push(("SESSION_TOKEN", t.into()));
        }
        if let Some(r) = str_field(config, "region") {
            params.push(("REGION", r.into()));
        }
        if let Some(e) = str_field(config, "endpoint") {
            // DuckDB's ENDPOINT param is the host[:port], not the full URL.
            let stripped = e
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .trim_end_matches('/');
            params.push(("ENDPOINT", stripped.into()));
            if e.starts_with("http://") {
                params.push(("USE_SSL", "false".into()));
            }
        }
        // MinIO / R2 / S3-compat endpoints typically need path-style.
        // Default to path when an endpoint is set, vhost otherwise; allow
        // explicit override via config.url_style.
        let default_style = if str_field(config, "endpoint").is_some() {
            "path"
        } else {
            "vhost"
        };
        let style = str_field(config, "url_style").unwrap_or(default_style);
        params.push(("URL_STYLE", style.into()));

        DuckDbSecretSpec {
            secret_type: "s3",
            params,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duckdb_secret_includes_session_token() {
        let conn = S3Connector;
        let config = serde_json::json!({
            "bucket": "my-bucket",
            "region": "us-east-1",
            "access_key_id": "AKIA",
            "secret_access_key": "xxx",
            "session_token": "FwoGZXIvYXdz..."
        });
        let spec = conn.duckdb_secret(&config);
        assert_eq!(spec.secret_type, "s3");
        let names: Vec<&str> = spec.params.iter().map(|(k, _)| *k).collect();
        assert!(names.contains(&"KEY_ID"));
        assert!(names.contains(&"SECRET"));
        assert!(names.contains(&"SESSION_TOKEN"));
        assert!(names.contains(&"REGION"));
    }

    #[test]
    fn duckdb_secret_defaults_to_path_style_for_custom_endpoint() {
        let conn = S3Connector;
        let config = serde_json::json!({
            "bucket": "b",
            "endpoint": "http://minio:9000",
            "access_key_id": "k",
            "secret_access_key": "s",
        });
        let spec = conn.duckdb_secret(&config);
        let url_style = spec.params.iter().find(|(k, _)| *k == "URL_STYLE").unwrap();
        assert_eq!(url_style.1, "path");
        assert!(spec.params.iter().any(|(k, v)| *k == "USE_SSL" && v == "false"));
    }
}
