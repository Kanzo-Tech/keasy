use object_store::azure::{MicrosoftAzure, MicrosoftAzureBuilder};
use object_store::path::Path as ObjectPath;
use super::{str_field, CloudStore, ConnectorDirection, ConnectorType, ConnectorTypeInfo};

pub struct AzureConnector;

fn build_azure(config: &serde_json::Value) -> Result<(MicrosoftAzure, ObjectPath), String> {
    let container = str_field(config, "container").ok_or("container required")?;
    let prefix = str_field(config, "prefix").unwrap_or("");

    let mut builder = MicrosoftAzureBuilder::new().with_container_name(container);
    if let Some(a) = str_field(config, "account_name") {
        builder = builder.with_account(a);
    }
    if let Some(k) = str_field(config, "access_key") {
        builder = builder.with_access_key(k);
    }
    if let Some(t) = str_field(config, "sas_token") {
        let pairs: Vec<(String, String)> = t
            .trim_start_matches('?')
            .split('&')
            .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
            .collect();
        builder = builder.with_sas_authorization(pairs);
    }

    let store = builder.build().map_err(|e| format!("Azure build failed: {e}"))?;
    let path = if prefix.is_empty() {
        ObjectPath::from("")
    } else {
        ObjectPath::from(prefix)
    };
    Ok((store, path))
}

impl ConnectorType for AzureConnector {
    fn info(&self) -> ConnectorTypeInfo {
        ConnectorTypeInfo {
            id: "azure_blob",
            name: "Azure Blob Storage",
            description: "Azure Blob container",
            direction: ConnectorDirection::Both,
            secret_fields: &["sas_token", "access_key"],
        }
    }

    fn validate(&self, config: &serde_json::Value) -> Result<(), String> {
        str_field(config, "account_name").ok_or("account_name is required")?;
        str_field(config, "container").ok_or("container is required")?;
        Ok(())
    }

    fn base_url(&self, config: &serde_json::Value) -> String {
        let _account = str_field(config, "account_name").unwrap_or("");
        let container = str_field(config, "container").unwrap_or("");
        let prefix = str_field(config, "prefix").unwrap_or("");
        if prefix.is_empty() {
            format!("az://{container}")
        } else {
            format!("az://{container}/{prefix}")
        }
    }

    fn cloud_config(&self, config: &serde_json::Value) -> Option<Vec<(String, String)>> {
        let mut pairs: Vec<(String, String)> = vec![];
        if let Some(a) = str_field(config, "account_name") { pairs.push(("azure_storage_account_name".into(), a.into())); }
        if let Some(k) = str_field(config, "access_key") { pairs.push(("azure_storage_access_key".into(), k.into())); }
        if let Some(t) = str_field(config, "sas_token") { pairs.push(("azure_storage_sas_token".into(), t.into())); }
        if pairs.is_empty() { return None; }
        Some(pairs)
    }

    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(CloudStore, ObjectPath), String> {
        let (store, path) = build_azure(config)?;
        Ok((CloudStore::Azure(store), path))
    }
}
