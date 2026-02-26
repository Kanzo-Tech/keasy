use serde::{Deserialize, Serialize};

use crate::dcat::types::DcatInput;
use crate::pipeline::PipelineSummary;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    Integrated,
    Scheduled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Draft,
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
    pub error: Option<super::errors::JobRuntimeError>,
    pub mode: RunMode,
    pub pipeline: PipelineSummary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog: Option<String>,
    #[serde(skip)]
    pub dcat_input: Option<DcatInput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connection_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateJobRequest {
    pub script: String,
    pub name: Option<String>,
    pub mode: Option<RunMode>,
    pub pipeline: Option<PipelineSummary>,
    pub dcat_enabled: Option<bool>,
    pub dcat_format: Option<String>,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateJobRequest {
    pub script: Option<String>,
    pub name: Option<String>,
}

pub fn now_iso8601() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}
