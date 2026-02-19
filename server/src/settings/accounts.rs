use dashmap::DashMap;
use fossil_lang::runtime::storage::StorageConfig;
use secrecy::{ExposeSecret, SecretString};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use tracing::{debug, info};

use super::file_store::FileStore;
use super::schema::find_provider;
use super::types::*;

#[derive(Clone)]
pub struct CloudAccountStore {
    accounts: Arc<DashMap<String, CloudAccount>>,
    persistence: FileStore<HashMap<String, StoredCloudAccount>>,
}

impl CloudAccountStore {
    pub fn new(data_dir: &Path, secret_key: Option<SecretString>) -> Self {
        let persistence = FileStore::new(data_dir.join("cloud_accounts.enc"), secret_key);
        let accounts = Arc::new(DashMap::new());

        for (id, stored) in persistence.read() {
            accounts.insert(id, CloudAccount::from(stored));
        }

        Self { accounts, persistence }
    }

    pub fn list(&self) -> Vec<CloudAccountSummary> {
        self.accounts.iter().map(|e| Self::to_summary(e.value())).collect()
    }

    pub fn get(&self, id: &str) -> Option<CloudAccount> {
        self.accounts.get(id).map(|e| e.value().clone())
    }

    pub fn get_summary(&self, id: &str) -> Option<CloudAccountSummary> {
        self.accounts.get(id).map(|e| Self::to_summary(e.value()))
    }

    pub fn create(&self, request: CreateCloudAccountRequest) -> Result<CloudAccountSummary, String> {
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
            if !field.optional {
                let has_value = all_values.get(field.name).is_some_and(|v| !v.is_empty());
                if !has_value && field.default_value.is_none() {
                    return Err(format!("missing required field: {}", field.name));
                }
            }
        }

        for field in &active {
            if let Some(default) = field.default_value {
                all_values.entry(field.name.to_string()).or_insert_with(|| default.to_string());
            }
        }

        let (fields, secrets) = split_fields_secrets(&active, all_values);

        let id = uuid::Uuid::new_v4().to_string();
        let account = CloudAccount {
            id: id.clone(),
            name: request.name,
            provider_id: request.provider_id,
            auth_method: request.auth_method,
            fields,
            secrets,
        };

        let summary = Self::to_summary(&account);
        self.accounts.insert(id, account);
        self.persist();

        debug!(account_id = %summary.id, "created cloud account");
        Ok(summary)
    }

    pub fn update(&self, id: &str, request: UpdateCloudAccountRequest) -> Result<CloudAccountSummary, String> {
        let mut entry = self.accounts.get_mut(id)
            .ok_or_else(|| format!("cloud account not found: {id}"))?;
        let account = entry.value_mut();

        if let Some(name) = request.name {
            account.name = name;
        }
        if let Some(auth_method) = request.auth_method {
            account.auth_method = Some(auth_method);
        }
        if let Some(new_values) = request.fields {
            let schema = find_provider(&account.provider_id);
            let active = schema
                .map(|s| s.active_fields(account.auth_method.as_deref()))
                .unwrap_or_default();

            for (key, value) in new_values {
                let is_secret = active.iter().find(|f| f.name == key).is_some_and(|f| f.secret);
                if is_secret {
                    if value.is_empty() { continue; }
                    account.secrets.insert(key, SecretString::from(value));
                } else {
                    account.fields.insert(key, value);
                }
            }
        }

        let summary = Self::to_summary(account);
        drop(entry);
        self.persist();
        Ok(summary)
    }

    pub fn remove(&self, id: &str) {
        self.accounts.remove(id);
        self.persist();
    }

    pub fn build_storage_config(&self, account_ids: &[String]) -> StorageConfig {
        let mut env = HashMap::new();
        for id in account_ids {
            if let Some(entry) = self.accounts.get(id) {
                let account = entry.value();
                if let Some(schema) = find_provider(&account.provider_id) {
                    for field in schema.active_fields(account.auth_method.as_deref()) {
                        if let Some(env_var) = field.env_var {
                            if field.secret {
                                if let Some(secret) = account.secrets.get(field.name) {
                                    env.insert(env_var.to_string(), secret.expose_secret().to_string());
                                }
                            } else if let Some(value) = account.fields.get(field.name) {
                                env.insert(env_var.to_string(), value.clone());
                            }
                        }
                    }
                }
            }
        }
        if !env.is_empty() {
            let keys: Vec<&str> = env.keys().map(|k| k.as_str()).collect();
            info!(count = env.len(), ?keys, "built storage config from cloud accounts");
        }
        StorageConfig::new(env)
    }

    pub fn env_snapshot(&self, account_ids: &[String]) -> HashMap<String, String> {
        self.build_storage_config(account_ids).as_map().clone()
    }

    pub fn env_snapshot_all(&self) -> HashMap<String, String> {
        let all_ids: Vec<String> = self.accounts.iter().map(|e| e.key().clone()).collect();
        self.env_snapshot(&all_ids)
    }

    pub fn provider_id(&self, account_id: &str) -> Option<String> {
        self.accounts.get(account_id).map(|e| e.value().provider_id.clone())
    }

    fn to_summary(account: &CloudAccount) -> CloudAccountSummary {
        CloudAccountSummary {
            id: account.id.clone(),
            name: account.name.clone(),
            provider_id: account.provider_id.clone(),
            auth_method: account.auth_method.clone(),
            fields: account.fields.clone(),
        }
    }

    fn persist(&self) {
        let snapshot: HashMap<String, StoredCloudAccount> = self
            .accounts
            .iter()
            .map(|e| (e.key().clone(), StoredCloudAccount::from(e.value())))
            .collect();
        self.persistence.write(snapshot);
    }
}

fn split_fields_secrets(
    active: &[&super::schema::FieldSchema],
    mut all_values: HashMap<String, String>,
) -> (HashMap<String, String>, HashMap<String, SecretString>) {
    let mut fields = HashMap::new();
    let mut secrets = HashMap::new();
    let secret_names: std::collections::HashSet<&str> =
        active.iter().filter(|f| f.secret).map(|f| f.name).collect();

    for (key, value) in all_values.drain() {
        if secret_names.contains(key.as_str()) {
            secrets.insert(key, SecretString::from(value));
        } else {
            fields.insert(key, value);
        }
    }

    (fields, secrets)
}
