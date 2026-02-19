use serde::{Deserialize, Serialize};

use crate::dcat::types::DcatInput;
use crate::routes::scripts::{OutputInfo, SourceInfo};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    Integrated,
    Scheduled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: String,
    pub status: JobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<super::errors::JobError>,
    pub mode: RunMode,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<SourceInfo>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outputs: Vec<OutputInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog: Option<String>,
    #[serde(skip)]
    pub dcat_input: Option<DcatInput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cloud_account_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateJobRequest {
    pub script: String,
    pub name: Option<String>,
    pub mode: Option<RunMode>,
    pub sources: Option<Vec<SourceInfo>>,
    pub outputs: Option<Vec<OutputInfo>>,
    pub dcat_enabled: Option<bool>,
    pub dcat_format: Option<String>,
    #[serde(default)]
    pub cloud_account_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ErrorEnvelope {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

pub fn now_iso8601() -> String {
    jiff::Zoned::now().strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}
