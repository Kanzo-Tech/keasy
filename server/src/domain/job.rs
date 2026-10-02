use serde::{Deserialize, Serialize};

use super::{JobFolder, StorageLocation, now_iso8601};

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
    /// The runner's last heartbeat while the job runs: its lease.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_at: Option<String>,
    /// Why a `Failed` run failed, as the browser that ran it reported it: a
    /// problem (`{ code, title, detail, data, … }`), stored verbatim and
    /// **opaque** — the web branches on its `code`, the server never does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Value>)]
    pub problem: Option<serde_json::Value>,
    /// Keycloak `sub` of the member who created the job, and the only one who
    /// may see, change, run or read it. Taken from the token, never the body.
    pub created_by: String,
    /// The sink connection the output lands in, under `{sink.url}/{folder}`,
    /// signed with that connection's credential.
    pub sink_connection: String,
    /// The folder under the sink the output lands in. A draft may not have one
    /// yet; every other job does, and no two of them share one in a sink.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
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

impl Job {
    /// A job as a create request asks for it: `Draft` or `Pending`, not yet run.
    pub fn new(
        status: JobStatus,
        name: Option<String>,
        sink_connection: String,
        folder: Option<JobFolder>,
        script: String,
        created_by: String,
    ) -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        Self {
            status,
            name: name.or_else(|| Some(id[..8].to_string())),
            created_at: now_iso8601(),
            started_at: None,
            completed_at: None,
            heartbeat_at: None,
            problem: None,
            created_by,
            sink_connection,
            folder: folder.map(JobFolder::into_inner),
            script: Some(script),
            manifest: None,
            relations: Vec::new(),
            id,
        }
    }

    /// Where the output lives: the sink, plus the folder the member chose;
    /// `None` for a draft that has none yet. **This is the one place keasy
    /// composes an output path**, and it is keasy's to compose — a job's home
    /// is the host's decision, not the language's. Everything below it
    /// (relation names, file names, tile names) belongs to fossil and travels
    /// from fossil.
    pub fn output_under(&self, sink: &StorageLocation) -> Option<StorageLocation> {
        self.folder.as_deref().map(|folder| sink.child(folder))
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_output_lands_in_the_folder_under_the_sink() {
        let sink = StorageLocation::parse("s3://b/output/").unwrap();
        let folder = |f: Option<&str>| {
            Job::new(
                JobStatus::Pending,
                None,
                "sink".into(),
                f.map(|f| JobFolder::parse(f).unwrap()),
                "x".into(),
                "u-1".into(),
            )
        };

        let job = folder(Some("people"));
        assert_eq!(
            job.output_under(&sink).unwrap().to_string(),
            "s3://b/output/people/"
        );
        assert_eq!(folder(None).output_under(&sink), None);
    }
}
