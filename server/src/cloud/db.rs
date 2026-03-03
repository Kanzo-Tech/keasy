use std::collections::HashMap;

use fossil_lang::runtime::storage::StorageConfig;
use rusqlite::params;
use secrecy::{ExposeSecret, SecretString};
use tracing::{info, warn};

use crate::settings::schema::find_provider;
use crate::db::Database;
use crate::tenant::{OrgId, TenantScoped};

use super::models::{CloudAccount, CloudAccountSummary, CreateCloudAccountRequest, UpdateCloudAccountRequest};

impl Database {
    pub async fn create_cloud_account(
        &self,
        ctx: &TenantScoped<()>,
        request: CreateCloudAccountRequest,
    ) -> Result<CloudAccountSummary, String> {
        let schema = find_provider(&request.provider_id)
            .ok_or_else(|| format!("unknown provider: {}", request.provider_id))?;

        if !schema.auth_methods.is_empty() {
            let method = request
                .auth_method
                .as_deref()
                .ok_or("auth_method is required for this provider")?;
            if !schema.auth_methods.iter().any(|a| a.name == method) {
                return Err(format!("unknown auth_method: {method}"));
            }
        }

        let active = schema.active_fields(request.auth_method.as_deref());
        let mut all_values = request.fields;

        for field in &active {
            if !field.optional
                && all_values.get(field.name).is_none_or(|v| v.is_empty())
                && field.default_value.is_none()
            {
                return Err(format!("missing required field: {}", field.name));
            }
            if let Some(default) = field.default_value {
                all_values
                    .entry(field.name.to_string())
                    .or_insert_with(|| default.to_string());
            }
        }

        let (fields, secrets) = split_fields_secrets(&active, all_values);

        let id = uuid::Uuid::new_v4().to_string();
        let fields_json = serde_json::to_string(&fields)
            .map_err(|e| format!("failed to serialize fields: {e}"))?;

        let conn = self.write().await;
        conn.execute(
            "INSERT INTO cloud_accounts (id, organization_id, name, provider_id, auth_method, fields)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, ctx.org_id().as_str(), request.name, request.provider_id, request.auth_method, fields_json],
        )
        .map_err(|e| format!("failed to insert cloud account: {e}"))?;
        drop(conn);

        self.set_secret_json(&format!("cloud_account:{id}"), &secrets).await;

        Ok(CloudAccountSummary {
            id,
            name: request.name,
            provider_id: request.provider_id,
            auth_method: request.auth_method,
            fields,
        })
    }

    pub async fn get_cloud_account(&self, ctx: &TenantScoped<&str>) -> Option<CloudAccount> {
        let summary = self.get_cloud_account_summary(ctx).await?;
        let secrets = self.decrypt_secrets_for_account(ctx.inner()).await;
        Some(CloudAccount {
            id: summary.id,
            name: summary.name,
            provider_id: summary.provider_id,
            auth_method: summary.auth_method,
            fields: summary.fields,
            secrets,
        })
    }

    pub async fn get_cloud_account_summary(&self, ctx: &TenantScoped<&str>) -> Option<CloudAccountSummary> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, provider_id, auth_method, fields FROM cloud_accounts WHERE id = ?1 AND organization_id = ?2",
            params![ctx.inner(), ctx.org_id().as_str()],
            row_to_cloud_account_summary,
        )
        .ok()
    }

    pub async fn update_cloud_account(
        &self,
        ctx: &TenantScoped<&str>,
        request: UpdateCloudAccountRequest,
    ) -> Result<CloudAccountSummary, String> {
        let account = self
            .get_cloud_account(ctx)
            .await
            .ok_or_else(|| format!("cloud account not found: {}", ctx.inner()))?;

        let name = request.name.unwrap_or(account.name);
        let auth_method = request.auth_method.or(account.auth_method);
        let mut fields = account.fields;
        let mut secrets = account.secrets;

        if let Some(new_values) = request.fields {
            let active = find_provider(&account.provider_id)
                .map(|s| s.active_fields(auth_method.as_deref()))
                .unwrap_or_default();

            for (key, value) in new_values {
                if active.iter().any(|f| f.name == key && f.secret) {
                    if !value.is_empty() {
                        secrets.insert(key, SecretString::from(value));
                    }
                } else {
                    fields.insert(key, value);
                }
            }
        }

        let fields_json = serde_json::to_string(&fields)
            .map_err(|e| format!("failed to serialize fields: {e}"))?;
        let secrets_plain: HashMap<&str, &str> = secrets
            .iter()
            .map(|(k, v)| (k.as_str(), v.expose_secret()))
            .collect();

        let conn = self.write().await;
        conn.execute(
            "UPDATE cloud_accounts SET name = ?1, auth_method = ?2, fields = ?3 WHERE id = ?4 AND organization_id = ?5",
            params![name, auth_method, fields_json, ctx.inner(), ctx.org_id().as_str()],
        )
        .map_err(|e| format!("failed to update cloud account: {e}"))?;
        drop(conn);

        self.set_secret_json(&format!("cloud_account:{}", ctx.inner()), &secrets_plain).await;

        Ok(CloudAccountSummary {
            id: ctx.inner().to_string(),
            name,
            provider_id: account.provider_id,
            auth_method,
            fields,
        })
    }

    pub async fn remove_cloud_account(&self, ctx: &TenantScoped<&str>) {
        let id = ctx.inner();
        let conn = self.write().await;
        let _ = conn.execute(
            "DELETE FROM cloud_accounts WHERE id = ?1 AND organization_id = ?2",
            params![id, ctx.org_id().as_str()],
        );
        drop(conn);
        self.delete_secret(&format!("cloud_account:{id}")).await;
    }

    pub async fn list_cloud_accounts(&self, ctx: &TenantScoped<()>) -> Vec<CloudAccountSummary> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare("SELECT id, name, provider_id, auth_method, fields FROM cloud_accounts WHERE organization_id = ?1")
            .expect("prepare list accounts");
        stmt.query_map([ctx.org_id().as_str()], row_to_cloud_account_summary)
        .expect("query accounts")
        .filter_map(|r| r.ok())
        .collect()
    }

    pub async fn build_storage_config(&self, ctx: &TenantScoped<()>, org_id: &str, account_ids: &[String]) -> StorageConfig {
        let mut env = HashMap::new();
        for id in account_ids {
            let scoped = TenantScoped::new(OrgId(org_id.to_string()), id.as_str());
            if let Some(account) = self.get_cloud_account(&scoped).await
                && let Some(schema) = find_provider(&account.provider_id)
            {
                for field in schema.active_fields(account.auth_method.as_deref()) {
                    let Some(env_var) = field.env_var else { continue };
                    let val = if field.secret {
                        account.secrets.get(field.name).map(|s| s.expose_secret().to_string())
                    } else {
                        account.fields.get(field.name).cloned()
                    };
                    if let Some(v) = val {
                        env.insert(env_var.to_string(), v);
                    }
                }
            }
        }
        let _ = ctx;
        if !env.is_empty() {
            let keys: Vec<&str> = env.keys().map(|k| k.as_str()).collect();
            info!(count = env.len(), ?keys, "built storage config from cloud accounts");
        }
        StorageConfig::new(env)
    }

    pub async fn env_snapshot(&self, ctx: &TenantScoped<()>, account_ids: &[String]) -> HashMap<String, String> {
        self.build_storage_config(ctx, ctx.org_id().as_str(), account_ids).await.as_map().clone()
    }

    async fn decrypt_secrets_for_account(&self, id: &str) -> HashMap<String, SecretString> {
        let Some(blob) = self.get_secret(&format!("cloud_account:{id}")).await else {
            return HashMap::new();
        };
        match serde_json::from_slice::<HashMap<String, String>>(&blob) {
            Ok(map) => map
                .into_iter()
                .map(|(k, v)| (k, SecretString::from(v)))
                .collect(),
            Err(e) => {
                warn!(account_id = id, error = %e, "failed to parse decrypted secrets");
                HashMap::new()
            }
        }
    }

    async fn set_secret_json(&self, key: &str, value: &impl serde::Serialize) {
        let json = serde_json::to_vec(value).expect("failed to serialize secret JSON");
        self.set_secret(key, &json).await;
    }
}

fn split_fields_secrets(
    active: &[&crate::settings::schema::FieldSchema],
    mut all_values: HashMap<String, String>,
) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut fields = HashMap::new();
    let mut secrets = HashMap::new();
    for (key, value) in all_values.drain() {
        if active.iter().any(|f| f.name == key && f.secret) {
            secrets.insert(key, value);
        } else {
            fields.insert(key, value);
        }
    }
    (fields, secrets)
}

fn row_to_cloud_account_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<CloudAccountSummary> {
    Ok(CloudAccountSummary {
        id: row.get("id")?,
        name: row.get("name")?,
        provider_id: row.get("provider_id")?,
        auth_method: row.get("auth_method")?,
        fields: serde_json::from_str(&row.get::<_, String>("fields")?).unwrap_or_default(),
    })
}
