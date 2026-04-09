use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::db::diesel_schema::jobs;
use crate::graph::dcat::types::DcatInput;
use crate::graph::manifest::DataManifest;
use super::pipeline_types::PipelineSummary;

// ── RunMode enum (API-facing) ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    Integrated,
    Scheduled,
}

impl RunMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Integrated => "integrated",
            Self::Scheduled => "scheduled",
        }
    }

    pub fn from_db(s: &str) -> Self {
        match s {
            "scheduled" => Self::Scheduled,
            _ => Self::Integrated,
        }
    }
}

// ── JobStatus enum (API-facing) ─────────────────────────────────────

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

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_db(s: &str) -> Self {
        match s {
            "draft" => Self::Draft,
            "pending" => Self::Pending,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        }
    }
}

// ── Diesel row model (what the DB returns) ──────────────────────────

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = jobs)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct JobRow {
    pub id: String,
    pub organization_id: String,
    pub name: Option<String>,
    pub status: String,
    pub mode: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub pipeline: String,
    pub connector_ids: String,
    pub script: Option<String>,
    pub rdf_base: Option<String>,
    pub manifest: Option<String>,
    pub catalog_manifest: Option<String>,
    pub catalog_base: Option<String>,
}

// ── Diesel insert model ─────────────────────────────────────────────

#[derive(Debug, Insertable)]
#[diesel(table_name = jobs)]
pub struct NewJob {
    pub id: String,
    pub organization_id: String,
    pub name: Option<String>,
    pub status: String,
    pub mode: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub pipeline: String,
    pub connector_ids: String,
    pub script: Option<String>,
    pub rdf_base: Option<String>,
    pub manifest: Option<String>,
    pub catalog_manifest: Option<String>,
    pub catalog_base: Option<String>,
}

// ── Diesel update changeset ─────────────────────────────────────────

#[derive(Debug, Default, AsChangeset)]
#[diesel(table_name = jobs)]
pub struct JobChangeset {
    pub name: Option<Option<String>>,
    pub status: Option<String>,
    pub started_at: Option<Option<String>>,
    pub completed_at: Option<Option<String>>,
    pub error: Option<Option<String>>,
    pub pipeline: Option<String>,
    pub connector_ids: Option<String>,
    pub script: Option<Option<String>>,
    pub rdf_base: Option<Option<String>>,
    pub manifest: Option<Option<String>>,
    pub catalog_manifest: Option<Option<String>>,
    pub catalog_base: Option<Option<String>>,
}

// ── API-facing model ────────────────────────────────────────────────

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
    pub pipeline: PipelineSummary,
    #[serde(skip)]
    #[schema(ignore)]
    pub dcat_input: Option<DcatInput>,
    #[serde(default, alias = "connection_ids", skip_serializing_if = "Vec::is_empty")]
    pub connector_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// Base URL for RDF Parquet storage (set when job uses Rdf output).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rdf_base: Option<String>,
    /// GraphAr manifest with vertex/edge file paths and column statistics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest: Option<DataManifest>,
    /// DCAT-AP catalog manifest (parquets stored in promotor cloud).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_manifest: Option<DataManifest>,
    /// Base URL for catalog parquets in promotor storage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_base: Option<String>,
}

// ── From<JobRow> for Job ────────────────────────────────────────────

impl From<JobRow> for Job {
    fn from(r: JobRow) -> Self {
        let status = JobStatus::from_db(&r.status);
        let is_draft = status == JobStatus::Draft;
        Self {
            id: r.id,
            name: r.name,
            status,
            mode: RunMode::from_db(&r.mode),
            created_at: r.created_at,
            started_at: r.started_at,
            completed_at: r.completed_at,
            error: r.error.and_then(|j| serde_json::from_str(&j).ok()),
            pipeline: serde_json::from_str(&r.pipeline).unwrap_or_default(),
            dcat_input: None,
            connector_ids: serde_json::from_str(&r.connector_ids).unwrap_or_default(),
            script: if is_draft { r.script } else { None },
            rdf_base: r.rdf_base,
            manifest: r.manifest.and_then(|j| serde_json::from_str(&j).ok()),
            catalog_manifest: r.catalog_manifest.and_then(|j| serde_json::from_str(&j).ok()),
            catalog_base: r.catalog_base,
        }
    }
}

// ── API request types ───────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateJobRequest {
    pub script: String,
    pub name: Option<String>,
    pub mode: Option<RunMode>,
    pub pipeline: Option<PipelineSummary>,
    pub dcat_enabled: Option<bool>,
    #[serde(default, alias = "connection_ids")]
    pub connector_ids: Vec<String>,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateJobRequest {
    pub script: Option<String>,
    pub name: Option<String>,
}

pub fn now_iso8601() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%SZ").to_string()
}
