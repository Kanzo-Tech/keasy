use serde::{Deserialize, Serialize};

use super::{JobFolder, ResourceName, StorageLocation, now_iso8601};

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

impl JobStatus {
    /// Completed, failed or cancelled: nothing more happens to the job.
    pub fn has_ended(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct Job {
    pub id: String,
    pub status: JobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<ResourceName>)]
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
    /// reached with a credential vended from that connection's.
    pub sink_connection: String,
    /// The folder under the sink the output lands in. A draft may not have one
    /// yet; every other job does, and no two of them share one in a sink.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<JobFolder>)]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// What the run reported, verbatim and **opaque**: fossil's run report
    /// (`RunReport`, `{dest, dropped}`). keasy stores it, hands it back and
    /// never reads a field of it — the last time a host re-typed this struct,
    /// it ended up asking for `vertex/<Type>.parquet`, a file the layout pass
    /// deletes. What the corpus holds is the corpus's to say: a reader opens
    /// it and asks its `fossil_tables` and `fossil_columns`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Value>)]
    pub report: Option<serde_json::Value>,
}

impl Job {
    /// A job as it begins: a draft.
    pub fn new(
        name: Option<String>,
        sink_connection: String,
        folder: Option<JobFolder>,
        script: String,
        created_by: String,
    ) -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        Self {
            status: JobStatus::Draft,
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
            report: None,
            id,
        }
    }

    /// Where the output lives: the sink, plus the folder the member chose;
    /// `None` for a draft that has none yet. **This is the one place keasy
    /// composes an output path**, and it is keasy's to compose — a job's home
    /// is the host's decision, not the language's. Everything below it
    /// (table names, file names) belongs to fossil, and the corpus says it.
    pub fn output_under(&self, sink: &StorageLocation) -> Option<StorageLocation> {
        self.folder.as_deref().map(|folder| sink.child(folder))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_output_lands_in_the_folder_under_the_sink() {
        let sink = StorageLocation::parse("s3://b/output/").unwrap();
        let folder = |f: Option<&str>| {
            Job::new(
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
