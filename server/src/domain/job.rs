use crate::authentication::role::Caller;
use serde::{Deserialize, Serialize};

use super::{Access, JobFolder, ResourceName, StorageLocation, now_iso8601};
use crate::error::{ErrorCode, Refusal};

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
    /// The job's lease: taken when it is submitted, renewed by every
    /// `running` its runner reports. A job whose lease lapses is swept.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_at: Option<String>,
    /// Why a `Failed` run failed, as the browser that ran it reported it: a
    /// problem (`{ code, title, detail, data, … }`), stored verbatim and
    /// **opaque** — the web branches on its `code`, the server never does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Value>)]
    pub problem: Option<serde_json::Value>,
    /// Keycloak `sub` of who created the job: with an admin, the one who may
    /// change, run or delete it. Everyone in the workspace reads it. Taken from
    /// the token, never the body.
    pub created_by: String,
    /// Whether the caller may change, run or delete this job, worked out for
    /// each response: the interface draws what this says and does not
    /// re-derive it.
    #[serde(default)]
    pub can_modify: bool,
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
            can_modify: false,
            id,
        }
    }

    /// The draft becomes the job to run: it needs a folder, and its lease
    /// starts now — a runner has the lease to pick it up.
    pub fn submit(&mut self) -> Result<(), Transition> {
        self.edit()?;
        if self.folder.is_none() {
            return Err(Transition::NoFolder);
        }
        self.status = JobStatus::Pending;
        self.heartbeat_at = Some(now_iso8601());
        Ok(())
    }

    /// Whether the job may be edited: only a draft is.
    pub fn edit(&self) -> Result<(), Transition> {
        match self.status {
            JobStatus::Draft => Ok(()),
            _ => Err(Transition::NotDraft),
        }
    }

    /// What its runner reports: `running` starts the run, or renews its
    /// lease; an end records how it ended, and dates it. A run moves forward
    /// only, and only a submitted job is run.
    pub fn report(
        &mut self,
        status: JobStatus,
        report: Option<serde_json::Value>,
        problem: Option<serde_json::Value>,
    ) -> Result<(), Transition> {
        if matches!(status, JobStatus::Draft | JobStatus::Pending) {
            return Err(Transition::Backwards);
        }
        match self.status {
            JobStatus::Draft => return Err(Transition::NeverRun),
            ref ended if ended.has_ended() => return Err(Transition::Ended),
            _ => {}
        }
        let now = now_iso8601();
        // A cancelled job may have been stopped before it ever started.
        if status != JobStatus::Cancelled {
            self.started_at.get_or_insert_with(|| now.clone());
        }
        match &status {
            JobStatus::Running => self.heartbeat_at = Some(now.clone()),
            JobStatus::Completed => {
                self.report = report;
                self.problem = None;
            }
            JobStatus::Failed => self.problem = problem,
            _ => {}
        }
        if status.has_ended() {
            self.completed_at = Some(now);
        }
        self.status = status;
        Ok(())
    }

    /// The job as `caller` sees it: [`Job::can_modify`] filled in.
    pub fn seen_by(mut self, caller: &Caller) -> Self {
        self.can_modify = caller.may_modify(&self.created_by);
        self
    }

    /// Whether its dataset may be opened for `access`: read once it has
    /// completed, written only while it runs.
    pub fn may(&self, access: Access) -> Result<(), Transition> {
        match (access, &self.status) {
            (Access::Read, JobStatus::Completed) | (Access::Write, JobStatus::Running) => Ok(()),
            (Access::Read, _) => Err(Transition::NotCompleted),
            (Access::Write, status) if status.has_ended() => Err(Transition::Ended),
            (Access::Write, _) => Err(Transition::NotRunning),
        }
    }

    /// Whether it may be deleted: not while it is to run or running.
    pub fn delete(&self) -> Result<(), Transition> {
        match self.status {
            JobStatus::Pending | JobStatus::Running => Err(Transition::StillRunning),
            _ => Ok(()),
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

/// Why a job's state does not allow what was asked: the one table of a job's
/// moves, said on the wire through [`Refusal`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transition {
    NotDraft,
    NoFolder,
    /// A status a run never moves to: back to a draft, or to pending.
    Backwards,
    /// A draft is never run: it is submitted first.
    NeverRun,
    Ended,
    NotRunning,
    NotCompleted,
    StillRunning,
}

impl From<Transition> for Refusal {
    fn from(t: Transition) -> Self {
        match t {
            Transition::NotDraft => Refusal::conflict(
                ErrorCode::JobNotDraft,
                "Only a draft is edited or submitted",
            ),
            Transition::NoFolder => {
                Refusal::invalid_field("folder", "A job to run needs a folder for its output")
            }
            Transition::Backwards => {
                Refusal::invalid("A run reports running, completed, failed or cancelled")
            }
            Transition::NeverRun => Refusal::invalid("A draft is never run: submit it first"),
            Transition::Ended => Refusal::conflict(ErrorCode::JobEnded, "The job has ended"),
            Transition::NotRunning => {
                Refusal::conflict(ErrorCode::JobNotRunning, "The job is not running yet")
            }
            Transition::NotCompleted => Refusal::conflict(
                ErrorCode::JobNotCompleted,
                "The job has not completed, so it has no output to read",
            ),
            Transition::StillRunning => Refusal::conflict(
                ErrorCode::JobStillRunning,
                "Cannot delete a job that is still running",
            ),
        }
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
