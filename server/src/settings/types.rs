use secrecy::SecretString;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    Data,
    Vocab,
}

impl ConnectionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Data => "data",
            Self::Vocab => "vocab",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocationType {
    Cloud,
    Local,
}

impl LocationType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Cloud => "cloud",
            Self::Local => "local",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub kind: ConnectionKind,
    pub location_type: LocationType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_account_id: Option<String>,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateConnectionRequest {
    pub name: String,
    pub kind: ConnectionKind,
    pub location_type: LocationType,
    pub cloud_account_id: Option<String>,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConnectionRequest {
    pub name: Option<String>,
    pub kind: Option<ConnectionKind>,
    pub location_type: Option<LocationType>,
    pub cloud_account_id: Option<String>,
    pub url: Option<String>,
}
