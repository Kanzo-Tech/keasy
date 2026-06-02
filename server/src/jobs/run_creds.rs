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
use crate::db::Database;
use crate::jobs::fossil_runner::{ConnectionCreds, CloudSecret, RunCreds};
use crate::settings::schema::find_provider;
use crate::tenant::{OrgId, TenantScoped};

/// Assemble the [`RunCreds`] the fossil subprocess reads on stdin: the dest's
/// cloud secret (promotor storage) plus a per-`@conn-name` source map (each
/// connection's base URL + read secret).
///
/// Connections resolve under the job's own org; the dest account is the
/// promotor's. A connection with no cloud account, or a provider whose secret
/// intake is pending, contributes a `None` secret — fossil then reads it as a
/// public source rather than guessing credentials.
pub async fn build_run_creds(
    db: &Database,
    job_org_id: &str,
    connection_ids: &[String],
    dest_account: Option<(String, String)>,
) -> RunCreds {
    let dest = match dest_account {
        Some((org, account_id)) => {
            let ctx = TenantScoped::new(OrgId(org), account_id.as_str());
            db.get_cloud_account(&ctx).await.as_ref().and_then(cloud_secret)
        }
        None => None,
    };

    let mut connections = HashMap::new();
    for id in connection_ids {
        let ctx = TenantScoped::new(OrgId(job_org_id.to_string()), id.as_str());
        let Some(conn) = db.get_connection(&ctx).await else {
            continue;
        };
        let secret = match &conn.cloud_account_id {
            Some(account_id) => {
                let acc_ctx = TenantScoped::new(OrgId(job_org_id.to_string()), account_id.as_str());
                db.get_cloud_account(&acc_ctx).await.as_ref().and_then(cloud_secret)
            }
            None => None,
        };
        connections.insert(conn.name, ConnectionCreds { url: conn.url, secret });
    }

    RunCreds { dest, connections }
}

/// Project an account's stored credentials into a DuckDB `CREATE SECRET` spec,
/// or `None` when the provider's pipeline-secret intake is not yet wired.
///
/// Reference path is S3 (table-driven from each field's `duckdb_config_key`) and
/// Azure account-key (a synthesised `CONNECTION_STRING`). Azure SAS and GCS HMAC
/// return `None`: rather than guess credentials, the caller passes no secret and
/// the cloud read/write surfaces the real auth failure from DuckDB.
#[must_use]
pub fn cloud_secret(account: &CloudAccount) -> Option<CloudSecret> {
    match account.provider_id.as_str() {
        "s3" => Some(CloudSecret {
            secret_type: "s3".to_string(),
            params: non_empty(table_driven(account))?,
        }),
        "azure" => azure_secret(account),
        // GCS: DuckDB's gcs secret needs HMAC (KEY_ID/SECRET); keasy stores a
        // service-account JSON, kept for object_store URL signing only. HMAC
        // intake is a pending product decision.
        _ => None,
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

fn azure_secret(account: &CloudAccount) -> Option<CloudSecret> {
    match account.auth_method.as_deref() {
        Some("account_key") => {
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
        Some("service_principal") => {
            let mut params = table_driven(account);
            params.insert(
                "PROVIDER".to_string(),
                SecretString::from("service_principal"),
            );
            Some(CloudSecret {
                secret_type: "azure".to_string(),
                params: non_empty(params)?,
            })
        }
        // SAS-token intake pending.
        _ => None,
    }
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
