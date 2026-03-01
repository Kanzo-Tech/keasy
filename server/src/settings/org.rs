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
}
