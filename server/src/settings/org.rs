use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, utoipa::ToSchema)]
pub struct OrgSettings {
    pub publisher_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contact_email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_description: Option<String>,
    /// Cloud account ID for catalog parquet storage (set by promotor).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_cloud_account_id: Option<String>,
    /// Base URL for catalog parquet storage (e.g. s3://promotor/catalogs/).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_base_url: Option<String>,
}
