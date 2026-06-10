use serde::{Deserialize, Serialize};

/// Workspace identity (legal entity behind this instance). Single-row metadata,
/// stored in the `settings` table under `workspace_identity` — there is one
/// workspace per instance, so it needs no table of its own. `name` is the
/// display name (seeded from config at bootstrap); the rest is the DCAT
/// publisher identity, editable on the Organization → Details page.
#[derive(Debug, Clone, Serialize, Deserialize, Default, utoipa::ToSchema)]
pub struct WorkspaceIdentity {
    pub name: String,
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
