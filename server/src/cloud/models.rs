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

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateCloudAccountRequest {
    pub name: String,
    pub provider_id: String,
    pub auth_method: Option<String>,
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateCloudAccountRequest {
    pub name: Option<String>,
    pub auth_method: Option<String>,
    pub fields: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CloudAccountSummary {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_method: Option<String>,
    pub fields: HashMap<String, String>,
}
