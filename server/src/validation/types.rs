use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ValidationRequest {
    pub job_id: String,
    pub connection_id: String,
    pub shape_path: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ShapeValidationResult {
    pub valid: bool,
    pub errors: Vec<ShapeValidationError>,
    pub valid_nodes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ShapeValidationError {
    pub node: String,
    pub message: String,
}
