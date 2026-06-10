use rusqlite::types::{FromSql, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

use fossil_run_status::RunStatus;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    Integrated,
    Scheduled,
}

impl ToSql for RunMode {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        let s = match self {
            Self::Integrated => "integrated",
            Self::Scheduled => "scheduled",
        };
        Ok(s.into())
    }
}

impl FromSql for RunMode {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        Ok(match s {
            "scheduled" => Self::Scheduled,
            _ => Self::Integrated,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Draft,
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl ToSql for JobStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        let s = match self {
            Self::Draft => "draft",
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        };
        Ok(s.into())
    }
}

impl FromSql for JobStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let s = value.as_str()?;
        Ok(match s {
            "draft" => Self::Draft,
            "pending" => Self::Pending,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        })
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connection_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// GraphAr structure from the fossil subprocess: per-type Parquet + row
    /// count + columns, per-edge CSR/CSC pair. Its `dest` IS the dataset base
    /// URL — fossil's single description of the output, so keasy keeps no
    /// duplicate `rdf_base`. Column statistics are NOT here — the browser
    /// computes them from the Parquet (DuckDB-WASM).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest: Option<RunStatus>,
    /// DCAT-AP catalog graph structure (`fossil catalog` subprocess output):
    /// per-type Parquet + counts, stored in owner cloud. Its `dest` is the
    /// catalog base URL. Drives the catalog graph view (DuckDB-WASM reads the
    /// Parquet directly).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_manifest: Option<RunStatus>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateJobRequest {
    pub script: String,
    pub name: Option<String>,
    pub mode: Option<RunMode>,
    pub dcat_enabled: Option<bool>,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateJobRequest {
    pub script: Option<String>,
    pub name: Option<String>,
}

/// The browser-driven completion payload (PATCH `/v1/jobs/{id}`): after running
/// the mapping in the browser (`@fossil-lang/executor`) and uploading the output
/// by signed PUT, the client reports the run's outcome. `manifest` is the
/// executor's `RunStatus` — the SAME type the old subprocess produced — so the
/// discovery + DCAT paths consume it unchanged.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CompleteJobRequest {
    /// The terminal (or `Running`) status the client is transitioning the job to.
    pub status: JobStatus,
    /// The GraphAr `RunStatus` for the uploaded output (on `Completed`).
    #[serde(default)]
    pub manifest: Option<RunStatus>,
    /// The DCAT-AP catalog `RunStatus`, when the client also built the catalog.
    #[serde(default)]
    pub catalog_manifest: Option<RunStatus>,
    /// Failure message (on `Failed`) — classified into a `JobRuntimeError`.
    #[serde(default)]
    pub error: Option<String>,
}

pub fn now_iso8601() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}
