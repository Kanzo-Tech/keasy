use serde::{Deserialize, Serialize};

#[derive(
    Debug,
    Clone,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum JobStatus {
    Draft,
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
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
    pub error: Option<JobRuntimeError>,
    /// Keycloak `sub` of the member who created the job, and the only one who
    /// may see, change, run or read it. Taken from the token, never the body.
    pub created_by: String,
    /// The sink the output lands in, under `{sink.url}/{job_id}`, signed with
    /// that connection's credentials.
    pub sink_connection_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// What the run reported, verbatim and **opaque**: fossil's own run report,
    /// which IS the manifest the corpus carries. keasy stores it, hands it back
    /// and never reads a field of it — the last time a host re-typed this
    /// struct, it ended up asking for `vertex/<Type>.parquet`, a file the
    /// layout pass deletes. Its presence is the one thing keasy asks of it:
    /// "this job produced output".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Value>)]
    pub manifest: Option<serde_json::Value>,
    /// What the corpus holds and what it is called, as the corpus reader
    /// enumerated it (`@fossil-lang/corpus`). fossil names every relation and
    /// every file; keasy joins them to the destination it owns, signs them for
    /// reading and registers them in the catalog by reference.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relations: Vec<OutputRelation>,
}

/// What went wrong in a run, recorded on the failed job.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct JobRuntimeError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One addressable relation of a job's output, named by fossil.
///
/// `name` is the relation the corpus registers and queries by (`Person`,
/// `Person_knows_Person`) — **keasy does not compose it**; it is what the
/// corpus reader answered. `files` are the dataset-relative payload files the
/// corpus addressing enumerated, and `rows` the count it reported.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct OutputRelation {
    pub name: String,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<i64>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateJobRequest {
    pub script: String,
    pub name: Option<String>,
    /// Accepted, not acted on: DCAT publication is not built.
    pub dcat_enabled: Option<bool>,
    /// Where the output lands: a sink connection.
    pub sink_connection_id: String,
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
/// executor's run report, stored verbatim and never read.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CompleteJobRequest {
    /// The terminal (or `Running`) status the client is transitioning the job to.
    pub status: JobStatus,
    /// The run report for the uploaded output (on `Completed`) — opaque JSON.
    #[serde(default)]
    #[schema(value_type = Option<Value>)]
    pub manifest: Option<serde_json::Value>,
    /// Failure message (on `Failed`) — classified into a `JobRuntimeError`.
    #[serde(default)]
    pub error: Option<String>,
}

/// What the corpus reader enumerated for a finished job (PUT
/// `/v1/jobs/{id}/relations`). It arrives after completion because naming a
/// relation is the corpus's answer, not the report's: only a reader with the
/// manifests in hand can say what the dataset is called and which files carry
/// it.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PublishRelationsRequest {
    pub relations: Vec<OutputRelation>,
}
