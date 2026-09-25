use serde::{Deserialize, Serialize};

/// A source column as the browser described it.
#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Deserialize, Serialize, utoipa::ToSchema)]
pub struct FileSchema {
    pub connection_name: String,
    pub file_path: String,
    pub columns: Vec<ColumnInfo>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SuggestRequest {
    pub domain: String,
    pub schemas: Vec<FileSchema>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct CompetencyQuestion {
    pub id: String,
    pub question: String,
    pub rationale: String,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SuggestResponse {
    pub competency_questions: Vec<CompetencyQuestion>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct GenerateRequest {
    pub domain: String,
    pub competency_questions: Vec<String>,
    pub schemas: Vec<FileSchema>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct GenerateResponse {
    pub script: String,
}
