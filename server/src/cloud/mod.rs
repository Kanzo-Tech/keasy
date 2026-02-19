pub mod reader;
pub mod resolver;

use std::collections::HashMap;

use object_store::path::Path as ObjectPath;
use object_store::ObjectStore;

/// Parse a cloud URL into an `ObjectStore` + `ObjectPath`.
///
/// Shared between resolver (writes) and reader (list/download).
/// Credentials are applied directly to each builder using the same env var
/// names as the provider schema (e.g. AZURE_STORAGE_ACCOUNT_NAME).
pub fn build_store(
    url_str: &str,
    creds: &HashMap<String, String>,
) -> Result<(Box<dyn ObjectStore>, ObjectPath), Box<dyn std::error::Error + Send + Sync>> {
    let parsed = url::Url::parse(url_str)?;

    let bucket = parsed
        .host_str()
        .ok_or_else(|| format!("cloud URL missing bucket/container: {url_str}"))?;

    let object_key = parsed.path().strip_prefix('/').unwrap_or(parsed.path());
    let path = if object_key.is_empty() {
        ObjectPath::from("")
    } else {
        ObjectPath::parse(object_key)?
    };

    let store: Box<dyn ObjectStore> = match parsed.scheme() {
        "az" | "azure" | "abfss" | "abfs" | "adl" => {
            let mut b =
                object_store::azure::MicrosoftAzureBuilder::new().with_container_name(bucket);
            if let Some(v) = creds.get("AZURE_STORAGE_ACCOUNT_NAME") {
                b = b.with_account(v);
            }
            if let Some(v) = creds.get("AZURE_STORAGE_ACCOUNT_KEY") {
                b = b.with_access_key(v);
            }
            if let Some(v) = creds.get("AZURE_STORAGE_SAS_KEY") {
                let query = v.strip_prefix('?').unwrap_or(v);
                let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
                    .map(|(k, v)| (k.into_owned(), v.into_owned()))
                    .collect();
                b = b.with_sas_authorization(pairs);
            }
            if let Some(v) = creds.get("AZURE_STORAGE_CLIENT_ID") {
                b = b.with_client_id(v);
            }
            if let Some(v) = creds.get("AZURE_STORAGE_CLIENT_SECRET") {
                b = b.with_client_secret(v);
            }
            if let Some(v) = creds.get("AZURE_STORAGE_TENANT_ID") {
                b = b.with_tenant_id(v);
            }
            Box::new(b.build()?)
        }
        "s3" | "s3a" => {
            let mut b =
                object_store::aws::AmazonS3Builder::new().with_bucket_name(bucket);
            if let Some(v) = creds.get("AWS_ACCESS_KEY_ID") {
                b = b.with_access_key_id(v);
            }
            if let Some(v) = creds.get("AWS_SECRET_ACCESS_KEY") {
                b = b.with_secret_access_key(v);
            }
            if let Some(v) = creds.get("AWS_DEFAULT_REGION") {
                b = b.with_region(v);
            }
            if let Some(v) = creds.get("AWS_ENDPOINT_URL") {
                b = b.with_endpoint(v);
            }
            Box::new(b.build()?)
        }
        "gs" | "gcs" => {
            let mut b =
                object_store::gcp::GoogleCloudStorageBuilder::new().with_bucket_name(bucket);
            if let Some(v) = creds.get("GOOGLE_SERVICE_ACCOUNT_KEY") {
                b = b.with_service_account_key(v);
            }
            if let Some(v) = creds.get("GOOGLE_SERVICE_ACCOUNT") {
                b = b.with_service_account_path(v);
            }
            Box::new(b.build()?)
        }
        scheme => return Err(format!("unsupported cloud scheme: {scheme}://").into()),
    };

    Ok((store, path))
}
