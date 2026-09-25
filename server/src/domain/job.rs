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
    /// Why a `Failed` run failed, as the browser that ran it reported it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Keycloak `sub` of the member who created the job, and the only one who
    /// may see, change, run or read it. Taken from the token, never the body.
    pub created_by: String,
    /// The sink connection the output lands in, under `{sink.url}/{job_id}`,
    /// signed with that connection's credential.
    pub sink_connection: String,
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
    /// every file; keasy joins them to the destination it owns and signs them
    /// for reading.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relations: Vec<OutputRelation>,
}

/// One addressable relation of a job's output, named by fossil.
///
/// `name` is the relation the corpus registers and queries by (`Person`,
/// `Person_knows_Person`) — **keasy does not compose it**; it is what the
/// corpus reader answered. `files` are the dataset-relative payload files the
/// corpus addressing enumerated, `rows` the count it reported and `columns`
/// what a row carries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct OutputRelation {
    pub name: String,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<RelationColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct RelationColumn {
    pub name: String,
    /// The engine's spelling of the Parquet type (`VARCHAR`, `BIGINT`, …).
    pub data_type: String,
}
