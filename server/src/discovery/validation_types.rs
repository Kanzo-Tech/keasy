use serde::{Deserialize, Serialize};
use shex_ast::ShExFormat;

#[derive(Debug, Clone)]
pub enum ShapeFormat {
    ShEx(ShExFormat),
    Shacl,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ValidationRequest {
    pub data_url: String,
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
