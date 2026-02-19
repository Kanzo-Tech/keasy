use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub struct CloudAccount {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub auth_method: Option<String>,
    pub fields: HashMap<String, String>,
    pub secrets: HashMap<String, SecretString>,
}

impl Clone for CloudAccount {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            name: self.name.clone(),
            provider_id: self.provider_id.clone(),
            auth_method: self.auth_method.clone(),
            fields: self.fields.clone(),
            secrets: self
                .secrets
                .iter()
                .map(|(k, v)| (k.clone(), SecretString::from(v.expose_secret().to_string())))
                .collect(),
        }
    }
}

impl std::fmt::Debug for CloudAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CloudAccount")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("provider_id", &self.provider_id)
            .field("auth_method", &self.auth_method)
            .field("fields", &self.fields)
            .field("secrets", &format!("[{} redacted]", self.secrets.len()))
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCloudAccount {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_method: Option<String>,
    pub fields: HashMap<String, String>,
    #[serde(default)]
    pub secrets: HashMap<String, String>,
}

impl From<&CloudAccount> for StoredCloudAccount {
    fn from(account: &CloudAccount) -> Self {
        Self {
            id: account.id.clone(),
            name: account.name.clone(),
            provider_id: account.provider_id.clone(),
            auth_method: account.auth_method.clone(),
            fields: account.fields.clone(),
            secrets: account
                .secrets
                .iter()
                .map(|(k, v)| (k.clone(), v.expose_secret().to_string()))
                .collect(),
        }
    }
}

impl From<StoredCloudAccount> for CloudAccount {
    fn from(stored: StoredCloudAccount) -> Self {
        Self {
            id: stored.id,
            name: stored.name,
            provider_id: stored.provider_id,
            auth_method: stored.auth_method,
            fields: stored.fields,
            secrets: stored
                .secrets
                .into_iter()
                .map(|(k, v)| (k, SecretString::from(v)))
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateCloudAccountRequest {
    pub name: String,
    pub provider_id: String,
    pub auth_method: Option<String>,
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCloudAccountRequest {
    pub name: Option<String>,
    pub auth_method: Option<String>,
    pub fields: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct CloudAccountSummary {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_method: Option<String>,
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub cloud_account_id: String,
    pub container_url: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveConnectionRequest {
    pub name: String,
    pub cloud_account_id: String,
    pub container_url: String,
}

