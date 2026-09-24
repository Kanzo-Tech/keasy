use std::collections::HashMap;

use rusqlite::{OptionalExtension, params};
use secrecy::{ExposeSecret, SecretString};

use crate::db::{Database, DbError, DbResult, json_column};
use crate::settings::schema::find_provider;

use super::models::{
    CloudAccount, CloudAccountSummary, CreateCloudAccountRequest, UpdateCloudAccountRequest,
};

const COLUMNS: &str = "id, name, provider_id, auth_method, fields";

fn secret_key(id: &str) -> String {
    format!("cloud_account:{id}")
}

impl Database {
    pub async fn create_cloud_account(
        &self,
        request: CreateCloudAccountRequest,
    ) -> DbResult<CloudAccountSummary> {
        let schema = find_provider(&request.provider_id).ok_or_else(|| {
            DbError::Invalid(format!("unknown provider: {}", request.provider_id))
        })?;

        if !schema.auth_methods.is_empty() {
            let method = request.auth_method.as_deref().ok_or_else(|| {
                DbError::Invalid("auth_method is required for this provider".into())
            })?;
            if !schema.auth_methods.iter().any(|a| a.name == method) {
                return Err(DbError::Invalid(format!("unknown auth_method: {method}")));
            }
        }

        let active = schema.active_fields(request.auth_method.as_deref());
        let mut values = request.fields;
        for field in &active {
            if let Some(default) = field.default_value {
                values
                    .entry(field.name.to_string())
                    .or_insert_with(|| default.to_string());
            }
            if !field.optional && values.get(field.name).is_none_or(|v| v.is_empty()) {
                return Err(DbError::Invalid(format!(
                    "missing required field: {}",
                    field.name
                )));
            }
        }

        let mut fields = HashMap::new();
        let mut secrets = HashMap::new();
        for (key, value) in values {
            if active.iter().any(|f| f.name == key && f.secret) {
                secrets.insert(key, value);
            } else {
                fields.insert(key, value);
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        self.write().await.execute(
            &format!("INSERT INTO cloud_accounts ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5)"),
            params![
                id,
                request.name,
                request.provider_id,
                request.auth_method,
                serde_json::to_string(&fields)?
            ],
        )?;
        self.set_secret(&secret_key(&id), &serde_json::to_vec(&secrets)?)
            .await?;

        Ok(CloudAccountSummary {
            id,
            name: request.name,
            provider_id: request.provider_id,
            auth_method: request.auth_method,
            fields,
        })
    }

    pub async fn get_cloud_account(&self, id: &str) -> DbResult<Option<CloudAccount>> {
        let Some(summary) = self.get_cloud_account_summary(id).await? else {
            return Ok(None);
        };
        let secrets = match self.get_secret(&secret_key(id)).await? {
            Some(blob) => serde_json::from_slice::<HashMap<String, String>>(&blob)?
                .into_iter()
                .map(|(k, v)| (k, SecretString::from(v)))
                .collect(),
            None => HashMap::new(),
        };
        Ok(Some(CloudAccount {
            name: summary.name,
            provider_id: summary.provider_id,
            auth_method: summary.auth_method,
            fields: summary.fields,
            secrets,
        }))
    }

    pub async fn get_cloud_account_summary(
        &self,
        id: &str,
    ) -> DbResult<Option<CloudAccountSummary>> {
        Ok(self
            .read()
            .await
            .query_row(
                &format!("SELECT {COLUMNS} FROM cloud_accounts WHERE id = ?1"),
                [id],
                row_to_summary,
            )
            .optional()?)
    }

    pub async fn update_cloud_account(
        &self,
        id: &str,
        request: UpdateCloudAccountRequest,
    ) -> DbResult<CloudAccountSummary> {
        let account = self
            .get_cloud_account(id)
            .await?
            .ok_or_else(|| DbError::Invalid(format!("cloud account not found: {id}")))?;

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
                    // An empty secret leaves the stored one in place.
                    if !value.is_empty() {
                        secrets.insert(key, SecretString::from(value));
                    }
                } else {
                    fields.insert(key, value);
                }
            }
        }

        self.write().await.execute(
            "UPDATE cloud_accounts SET name = ?1, auth_method = ?2, fields = ?3 WHERE id = ?4",
            params![name, auth_method, serde_json::to_string(&fields)?, id],
        )?;
        let plain: HashMap<&str, &str> = secrets
            .iter()
            .map(|(k, v)| (k.as_str(), v.expose_secret()))
            .collect();
        self.set_secret(&secret_key(id), &serde_json::to_vec(&plain)?)
            .await?;

        Ok(CloudAccountSummary {
            id: id.to_string(),
            name,
            provider_id: account.provider_id,
            auth_method,
            fields,
        })
    }

    pub async fn remove_cloud_account(&self, id: &str) -> DbResult<()> {
        self.write()
            .await
            .execute("DELETE FROM cloud_accounts WHERE id = ?1", [id])?;
        self.delete_secret(&secret_key(id)).await
    }

    pub async fn list_cloud_accounts(&self) -> DbResult<Vec<CloudAccountSummary>> {
        let conn = self.read().await;
        let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM cloud_accounts"))?;
        let accounts = stmt
            .query_map([], row_to_summary)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(accounts)
    }

    /// The object-store configuration (provider env-var names → values) the
    /// given accounts sign with.
    pub async fn build_storage_config(
        &self,
        account_ids: &[String],
    ) -> DbResult<HashMap<String, String>> {
        let mut env = HashMap::new();
        for id in account_ids {
            let Some(account) = self.get_cloud_account(id).await? else {
                continue;
            };
            let Some(schema) = find_provider(&account.provider_id) else {
                continue;
            };
            for field in schema.active_fields(account.auth_method.as_deref()) {
                let Some(env_var) = field.env_var else {
                    continue;
                };
                let value = if field.secret {
                    account
                        .secrets
                        .get(field.name)
                        .map(|s| s.expose_secret().to_string())
                } else {
                    account.fields.get(field.name).cloned()
                };
                if let Some(v) = value {
                    env.insert(env_var.to_string(), v);
                }
            }
        }
        Ok(env)
    }
}

fn row_to_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<CloudAccountSummary> {
    Ok(CloudAccountSummary {
        id: row.get("id")?,
        name: row.get("name")?,
        provider_id: row.get("provider_id")?,
        auth_method: row.get("auth_method")?,
        fields: json_column(row, "fields")?,
    })
}
