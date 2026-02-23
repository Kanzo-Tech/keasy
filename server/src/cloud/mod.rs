pub mod reader;
pub mod resolver;

use std::collections::HashMap;

use object_store::aws::AmazonS3ConfigKey;
use object_store::azure::AzureConfigKey;
use object_store::gcp::GoogleConfigKey;
use object_store::path::Path as ObjectPath;
use object_store::ObjectStore;

use crate::settings::schema::{all_cloud_schemes, find_provider_by_scheme};

pub fn is_cloud_url(s: &str) -> bool {
    all_cloud_schemes().any(|scheme| s.starts_with(scheme) && s[scheme.len()..].starts_with("://"))
}

pub fn is_data_path(s: &str) -> bool {
    is_cloud_url(s) || s.starts_with('/') || s.starts_with("./") || s.starts_with("../")
}

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

    let provider = find_provider_by_scheme(parsed.scheme())
        .ok_or_else(|| format!("unsupported cloud scheme: {}://", parsed.scheme()))?;

    let fields = provider.all_fields();

    macro_rules! build_with_creds {
        ($builder:expr, $key_type:ty) => {{
            let mut b = $builder;
            for field in &fields {
                if let (Some(ev), Some(ck)) = (field.env_var, field.store_config_key) {
                    if let Some(v) = creds.get(ev) {
                        b = b.with_config(ck.parse::<$key_type>().unwrap(), v);
                    }
                }
            }
            Box::new(b.build()?) as Box<dyn ObjectStore>
        }};
    }

    let store: Box<dyn ObjectStore> = match provider.id {
        "azure" => build_with_creds!(
            object_store::azure::MicrosoftAzureBuilder::new().with_container_name(bucket),
            AzureConfigKey
        ),
        "s3" => build_with_creds!(
            object_store::aws::AmazonS3Builder::new().with_bucket_name(bucket),
            AmazonS3ConfigKey
        ),
        "gcp" => build_with_creds!(
            object_store::gcp::GoogleCloudStorageBuilder::new().with_bucket_name(bucket),
            GoogleConfigKey
        ),
        _ => return Err(format!("no builder for provider: {}", provider.id).into()),
    };

    Ok((store, path))
}
