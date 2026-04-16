use std::collections::HashMap;
use std::sync::Arc;

use object_store::azure::MicrosoftAzureBuilder;
use object_store::path::Path as ObjectPath;

use super::{
    str_field, CloudStore, ConnectorDirection, ConnectorType, ConnectorTypeInfo, DuckDbSecretSpec,
};

/// Azure Blob Storage connector.
///
/// # Credential model
///
/// One canonical credential field: `connection_string`. This is the
/// format every Microsoft-official tool surfaces:
///
/// * `azcopy`, Azure Storage Explorer, Azure Portal ("Access keys →
///   Connection string"), AzureCLI and every Azure SDK emit it directly.
/// * `pg_duckdb` (from the DuckDB org) exposes exactly one Azure helper:
///   `duckdb.create_azure_secret('<connection string>', scope := ...)`.
///   Ref: <https://github.com/duckdb/pg_duckdb/blob/main/docs/secrets.md>
/// * DuckDB's `CREATE SECRET ... TYPE AZURE` accepts `CONNECTION_STRING`
///   as a first-class parameter.
///
/// Both shared-key and SAS authentication are expressed as connection
/// strings, per Microsoft's documented format:
///
/// * Shared key:
///   `DefaultEndpointsProtocol=https;AccountName=<a>;AccountKey=<k>;EndpointSuffix=core.windows.net`
/// * SAS:
///   `BlobEndpoint=https://<a>.blob.core.windows.net;SharedAccessSignature=<sas>`
///
/// Ref: <https://learn.microsoft.com/en-us/azure/storage/common/storage-configure-connection-string>
///
/// # Why keasy parses the string
///
/// `object_store::MicrosoftAzureBuilder` (verified against 0.12.5) has no
/// native connection string parser — only discrete setters
/// (`with_account`, `with_access_key`, `with_sas_authorization`,
/// `with_endpoint`). DuckDB's `TYPE AZURE` SECRET is the opposite: it
/// takes only `CONNECTION_STRING`. Two consumers, one canonical storage
/// format, so keasy parses once in `build_store` using Microsoft's
/// documented grammar (`split_once('=')` to preserve base64 padding on
/// `AccountKey`) and forwards verbatim to DuckDB in `duckdb_secret`.
pub struct AzureConnector;

impl ConnectorType for AzureConnector {
    fn info(&self) -> ConnectorTypeInfo {
        ConnectorTypeInfo {
            id: "azure_blob",
            name: "Azure Blob Storage",
            description: "Azure Blob container",
            direction: ConnectorDirection::Both,
            secret_fields: &["connection_string"],
        }
    }

    fn validate(&self, config: &serde_json::Value) -> Result<(), String> {
        str_field(config, "container").ok_or("container is required")?;
        let cs = str_field(config, "connection_string")
            .ok_or("connection_string is required")?;
        // Fail early on malformed strings — a cryptic object_store or
        // DuckDB error at job runtime would be harder to diagnose.
        let parsed = AzureCs::parse(cs);
        if parsed.account_name.is_none() && parsed.blob_endpoint.is_none() {
            return Err("connection_string must contain AccountName or BlobEndpoint".into());
        }
        if parsed.account_key.is_none() && parsed.sas_token.is_none() {
            return Err(
                "connection_string must contain AccountKey or SharedAccessSignature".into(),
            );
        }
        Ok(())
    }

    fn base_url(&self, config: &serde_json::Value) -> String {
        let container = str_field(config, "container").unwrap_or("");
        let prefix = str_field(config, "prefix").unwrap_or("");
        if prefix.is_empty() {
            format!("az://{container}")
        } else {
            format!("az://{container}/{prefix}")
        }
    }

    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(Arc<dyn CloudStore>, ObjectPath), String> {
        let container = str_field(config, "container").ok_or("container required")?;
        let cs = str_field(config, "connection_string").ok_or("connection_string required")?;
        let parsed = AzureCs::parse(cs);
        let prefix = str_field(config, "prefix").unwrap_or("");

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
                .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
                .collect();
            builder = builder.with_sas_authorization(pairs);
        }
        if let Some(endpoint) = parsed.blob_endpoint {
            builder = builder.with_endpoint(endpoint.to_string());
        }

        let store = builder
            .build()
            .map_err(|e| format!("Azure build failed: {e}"))?;
        let path = if prefix.is_empty() {
            ObjectPath::from("")
        } else {
            ObjectPath::from(prefix)
        };
        Ok((Arc::new(store), path))
    }

    fn duckdb_secret(&self, config: &serde_json::Value) -> DuckDbSecretSpec {
        // Passthrough — DuckDB's TYPE AZURE SECRET accepts CONNECTION_STRING
        // as a first-class parameter. No parsing or synthesis here.
        let mut params: Vec<(&'static str, String)> = Vec::new();
        if let Some(cs) = str_field(config, "connection_string") {
            params.push(("CONNECTION_STRING", cs.into()));
        }
        DuckDbSecretSpec {
            secret_type: "azure",
            params,
        }
    }
}

// ── Connection string parser ───────────────────────────────────────────

/// Parsed components of an Azure Storage connection string.
///
/// Grammar: `Key=Value` pairs separated by `;`. Values may contain `=`
/// (notably `AccountKey`, which is base64 and may have `=` padding), so
/// `split_once('=')` splits on the first `=` per pair only.
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

    #[test]
    fn parses_shared_key_connection_string() {
        let cs = "DefaultEndpointsProtocol=https;AccountName=myacct;AccountKey=YWJjZA==;EndpointSuffix=core.windows.net";
        let p = AzureCs::parse(cs);
        assert_eq!(p.account_name, Some("myacct"));
        // `AccountKey` base64 padding must survive — `split_once('=')` is
        // what guarantees this.
        assert_eq!(p.account_key, Some("YWJjZA=="));
        assert_eq!(p.sas_token, None);
    }

    #[test]
    fn parses_sas_connection_string() {
        let cs = "BlobEndpoint=https://myacct.blob.core.windows.net;SharedAccessSignature=sv=2021-06-08&sig=xyz";
        let p = AzureCs::parse(cs);
        assert_eq!(p.blob_endpoint, Some("https://myacct.blob.core.windows.net"));
        assert_eq!(p.sas_token, Some("sv=2021-06-08&sig=xyz"));
        assert_eq!(p.account_key, None);
    }

    #[test]
    fn validate_rejects_empty_credentials() {
        let conn = AzureConnector;
        let config = serde_json::json!({
            "container": "data",
            "connection_string": "DefaultEndpointsProtocol=https;EndpointSuffix=core.windows.net"
        });
        assert!(conn.validate(&config).is_err());
    }

    #[test]
    fn duckdb_secret_is_passthrough() {
        let conn = AzureConnector;
        let cs = "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k;EndpointSuffix=core.windows.net";
        let config = serde_json::json!({
            "container": "data",
            "connection_string": cs,
        });
        let spec = conn.duckdb_secret(&config);
        assert_eq!(spec.secret_type, "azure");
        assert_eq!(spec.params.len(), 1);
        assert_eq!(spec.params[0].0, "CONNECTION_STRING");
        assert_eq!(spec.params[0].1, cs);
    }
}
