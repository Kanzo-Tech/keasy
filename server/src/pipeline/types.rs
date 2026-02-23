use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Field {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineInput {
    pub name: String,
    pub fields: Vec<Field>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FieldMapping {
    pub target: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OperationInput {
    pub source: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub key_fields: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineOperation {
    pub kind: String,
    pub label: String,
    pub fields: Vec<Field>,
    pub inputs: Vec<OperationInput>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PipelineOutput {
    pub type_name: String,
    pub fields: Vec<Field>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mappings: Vec<FieldMapping>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rdf_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PipelineSummary {
    pub inputs: Vec<PipelineInput>,
    pub operations: Vec<PipelineOperation>,
    pub outputs: Vec<PipelineOutput>,
}

#[derive(Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub pipeline: PipelineSummary,
    pub errors: Vec<String>,
}
