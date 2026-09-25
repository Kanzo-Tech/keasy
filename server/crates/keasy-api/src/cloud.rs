use std::collections::HashMap;

use secrecy::SecretString;
use serde::{Deserialize, Serialize};

/// Every field value arrives as a secret: which of them are credentials is the
/// provider schema's to say, and until it has, none is logged or printed.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateCloudAccountRequest {
    pub name: String,
    pub provider_id: String,
    pub auth_method: Option<String>,
    #[schema(value_type = HashMap<String, String>)]
    pub fields: HashMap<String, SecretString>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateCloudAccountRequest {
    pub name: Option<String>,
    pub auth_method: Option<String>,
    /// An empty secret keeps the stored one.
    #[schema(value_type = Option<HashMap<String, String>>)]
    pub fields: Option<HashMap<String, SecretString>>,
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

/// One object under a connection's prefix.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub last_modified: Option<String>,
}
