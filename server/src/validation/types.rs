use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy)]
pub enum ShapeFormat {
    ShEx,
    Shacl,
}

#[derive(Debug, Deserialize)]
pub struct ValidationRequest {
    pub data_url: String,
    pub connection_id: String,
    pub shape_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    pub valid_nodes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationError {
    pub node: String,
    pub message: String,
}
