//! Project a stored [`CloudAccount`] into the DuckDB `CREATE SECRET` spec
//! ([`CloudSecret`]) the fossil subprocess consumes over stdin.
//!
//! keasy owns one schema-driven provider table ([`ProviderSchema`]); this is its
//! projection onto the *pipeline* credential vocabulary (DuckDB secrets), parallel
//! to `build_storage_config`'s projection onto object_store env vars. Secrets stay
//! [`SecretString`] end to end — exposed only when the runner writes the child's
//! stdin pipe.
//!
//! [`ProviderSchema`]: crate::settings::schema::ProviderSchema

use std::collections::HashMap;

use secrecy::{ExposeSecret, SecretString};

use crate::cloud::models::CloudAccount;
use crate::jobs::fossil_runner::CloudSecret;
use crate::settings::schema::{SecretStrategy, find_provider};

/// Project an account's stored credentials into a DuckDB `CREATE SECRET` spec,
/// or `None` when the provider/method's pipeline-secret intake is not yet wired.
///
/// The projection is driven by the [`SecretStrategy`] declared in the provider
/// registry for the account's `(provider, auth_method)` — no provider-specific
/// branching here. `Pending` strategies (Azure SAS, GCS HMAC) return `None`:
/// rather than guess credentials, the caller passes no secret and the cloud
/// read/write surfaces the real auth failure from DuckDB.
#[must_use]
pub fn cloud_secret(account: &CloudAccount) -> Option<CloudSecret> {
    let schema = find_provider(&account.provider_id)?;
    match schema.secret_strategy(account.auth_method.as_deref()) {
        SecretStrategy::Pending => None,
        SecretStrategy::Fields { secret_type, extra } => {
            let mut params = table_driven(account);
            for (k, v) in *extra {
                params.insert((*k).to_string(), SecretString::from(*v));
            }
            Some(CloudSecret {
                secret_type: (*secret_type).to_string(),
                params: non_empty(params)?,
            })
        }
        SecretStrategy::AzureConnectionString => azure_connection_string(account),
    }
}

/// Read a field's value: secret fields from the encrypted vault, the rest from
/// the plain field map. Non-secret values are re-wrapped so the spec carries a
/// single type; the CLI quotes every `CREATE SECRET` value regardless.
fn field_value(account: &CloudAccount, name: &str, secret: bool) -> Option<SecretString> {
    if secret {
        account.secrets.get(name).cloned()
    } else {
        account
            .fields
            .get(name)
            .map(|v| SecretString::from(v.clone()))
    }
}

/// Build `CREATE SECRET` params 1:1 from the provider's active fields that
/// declare a `duckdb_config_key`. Missing values are skipped (optional fields).
fn table_driven(account: &CloudAccount) -> HashMap<String, SecretString> {
    let Some(schema) = find_provider(&account.provider_id) else {
        return HashMap::new();
    };
    schema
        .active_fields(account.auth_method.as_deref())
        .into_iter()
        .filter_map(|f| {
            let key = f.duckdb_config_key?;
            Some((key.to_string(), field_value(account, f.name, f.secret)?))
        })
        .collect()
}

/// Azure account-key projection: synthesise the `CONNECTION_STRING` DuckDB
/// secrets expect from the stored `account_name` + `account_key`.
fn azure_connection_string(account: &CloudAccount) -> Option<CloudSecret> {
    let name = account.fields.get("account_name")?;
    let key = account.secrets.get("account_key")?;
    let conn = format!(
        "DefaultEndpointsProtocol=https;AccountName={name};AccountKey={};EndpointSuffix=core.windows.net",
        key.expose_secret()
    );
    Some(CloudSecret {
        secret_type: "azure".to_string(),
        params: HashMap::from([(
            "CONNECTION_STRING".to_string(),
            SecretString::from(conn),
        )]),
    })
}

fn non_empty(params: HashMap<String, SecretString>) -> Option<HashMap<String, SecretString>> {
    (!params.is_empty()).then_some(params)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(
        provider_id: &str,
        auth_method: Option<&str>,
        fields: &[(&str, &str)],
        secrets: &[(&str, &str)],
    ) -> CloudAccount {
        CloudAccount {
            id: "acc-1".to_string(),
            name: "test".to_string(),
            provider_id: provider_id.to_string(),
            auth_method: auth_method.map(str::to_string),
            fields: fields
                .iter()
                .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                .collect(),
            secrets: secrets
                .iter()
                .map(|(k, v)| ((*k).to_string(), SecretString::from(*v)))
                .collect(),
        }
    }

    fn exposed(secret: &CloudSecret, key: &str) -> Option<String> {
        secret.params.get(key).map(|v| v.expose_secret().to_string())
    }

    #[test]
    fn s3_projects_table_driven_keys() {
        let acc = account(
            "s3",
            None,
            &[("region", "eu-west-1")],
            &[("access_key_id", "AKIA"), ("secret_access_key", "shh")],
        );
        let secret = cloud_secret(&acc).expect("s3 secret");
        assert_eq!(secret.secret_type, "s3");
        assert_eq!(exposed(&secret, "KEY_ID").as_deref(), Some("AKIA"));
        assert_eq!(exposed(&secret, "SECRET").as_deref(), Some("shh"));
        assert_eq!(exposed(&secret, "REGION").as_deref(), Some("eu-west-1"));
        // endpoint_url absent ⇒ no ENDPOINT param.
        assert!(!secret.params.contains_key("ENDPOINT"));
    }

    #[test]
    fn azure_account_key_synthesises_connection_string() {
        let acc = account(
            "azure",
            Some("account_key"),
            &[("account_name", "myacct")],
            &[("account_key", "k3y")],
        );
        let secret = cloud_secret(&acc).expect("azure secret");
        assert_eq!(secret.secret_type, "azure");
        let conn = exposed(&secret, "CONNECTION_STRING").expect("connection string");
        assert!(conn.contains("AccountName=myacct"), "{conn}");
        assert!(conn.contains("AccountKey=k3y"), "{conn}");
    }

    #[test]
    fn azure_service_principal_is_table_driven_with_provider() {
        let acc = account(
            "azure",
            Some("service_principal"),
            &[
                ("account_name", "myacct"),
                ("client_id", "cid"),
                ("tenant_id", "tid"),
            ],
            &[("client_secret", "csecret")],
        );
        let secret = cloud_secret(&acc).expect("azure spn secret");
        assert_eq!(exposed(&secret, "PROVIDER").as_deref(), Some("service_principal"));
        assert_eq!(exposed(&secret, "ACCOUNT_NAME").as_deref(), Some("myacct"));
        assert_eq!(exposed(&secret, "CLIENT_ID").as_deref(), Some("cid"));
        assert_eq!(exposed(&secret, "CLIENT_SECRET").as_deref(), Some("csecret"));
        assert_eq!(exposed(&secret, "TENANT_ID").as_deref(), Some("tid"));
    }

    #[test]
    fn gcs_secret_pending_returns_none() {
        let acc = account(
            "gcp",
            Some("service_account_key"),
            &[],
            &[("service_account_key", "{json}")],
        );
        assert!(cloud_secret(&acc).is_none());
    }

    #[test]
    fn secrets_never_leak_through_debug() {
        let acc = account("s3", None, &[], &[("secret_access_key", "leaky")]);
        let secret = cloud_secret(&acc).expect("s3 secret");
        assert!(!format!("{secret:?}").contains("leaky"));
    }
}
