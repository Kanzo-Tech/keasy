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
    /// Optional ShapeMap (compact syntax) for ShEx validation.
    /// If omitted, all subjects are validated against @start.
    pub shape_map: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub conformant: usize,
    pub non_conformant: usize,
    pub errors: Vec<ValidationError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationError {
    pub node: String,
    pub message: String,
}
