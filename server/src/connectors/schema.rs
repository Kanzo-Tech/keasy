use serde::{Deserialize, Serialize};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SchemaRequest {
    pub paths: Vec<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct SchemaEntry {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<ColumnInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ColumnInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub data_type: String,
}
