use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TabularData {
    pub columns: Vec<String>,
    #[schema(value_type = Vec<Object>)]
    pub rows: Vec<BTreeMap<String, serde_json::Value>>,
    pub column_types: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct SearchResult {
    pub id: String,
    pub label: String,
    pub group: String,
    pub description: Option<String>,
}
