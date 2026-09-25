use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, utoipa::ToSchema)]
pub struct OrgIdentity {
    pub legal_name: String,
    pub country: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registration_number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country_subdivision_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registration_number_type: Option<String>,
}

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
