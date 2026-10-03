use crate::authentication::role::{Caller, Role};
use serde::{Deserialize, Serialize};

use super::{Access, Actor, JobFolder, Provenance, ResourceName, StorageLocation, now_iso8601};
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
    /// Being written: edited, never run.
    Draft,
    /// Submitted, and nothing runs it: it waits for someone to run it.
    Idle,
    /// A browser runs it, and holds its lease: [`Job::runner`]'s.
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobStatus {
    /// Completed, failed or cancelled: the last run is over, and the job may
    /// be run again.
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
    /// When the last run started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// When the last run ended; unset while it runs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    /// The run's lease: taken by `run`, renewed by every `running` its runner
    /// reports. A running job whose lease lapses is swept as `job/abandoned`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_at: Option<String>,
    /// Keycloak `sub` of who runs the job, or ran it last: the one caller
    /// whose reports are taken, and the one vended its output to write.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runner: Option<String>,
    /// Someone asked the run to stop: its runner reads it in the answer to its
    /// next report, aborts, and reports `cancelled`.
    #[serde(default)]
    pub cancel_requested: bool,
    /// Why a `Failed` run failed, as the browser that ran it reported it: a
    /// problem (`{ code, title, detail, data, … }`), stored verbatim and
    /// **opaque** — the web branches on its `code`, the server never does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Value>)]
    pub problem: Option<serde_json::Value>,
    /// Who created the job — with an admin, the one who may change, run or
    /// delete it — and when. Taken from the token, never the body.
    #[serde(flatten)]
    pub provenance: Provenance,
    /// Whether the caller may change, run or delete this job, worked out for
    /// each response: the interface draws what this says and does not
    /// re-derive it.
    #[serde(default)]
    pub can_modify: bool,
    /// Whether the caller may stop the run under way — its runner, or an
    /// admin — worked out for each response; false when nothing runs.
    #[serde(default)]
    pub can_stop: bool,
    /// The sink connection the output lands in, under `{sink.url}/{folder}`,
    /// reached with a credential vended from that connection's.
    pub sink_connection: String,
    /// The folder under the sink the output lands in. A draft may not have one
    /// yet; every other job does, and no two of them share one in a sink.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<JobFolder>)]
    pub folder: Option<String>,
    /// Where the output lands, `{sink}/{folder}/`, as the sink's URL spells
    /// it: worked out for each response; unset for a draft with no folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// The program every run of the job runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    /// What the last run reported, verbatim and **opaque**: fossil's run report
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
        created_by: Actor,
    ) -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        Self {
            status: JobStatus::Draft,
            name: name.or_else(|| Some(id[..8].to_string())),
            started_at: None,
            completed_at: None,
            heartbeat_at: None,
            runner: None,
            cancel_requested: false,
            problem: None,
            provenance: Provenance::created(created_by),
            sink_connection,
            folder: folder.map(JobFolder::into_inner),
            output: None,
            script: Some(script),
            report: None,
            can_modify: false,
            can_stop: false,
            id,
        }
    }

    /// The draft becomes a job to run: it needs a folder, and it waits, idle,
    /// for someone to run it.
    pub fn submit(&mut self) -> Result<(), Transition> {
        self.edit()?;
        if self.folder.is_none() {
            return Err(Transition::NoFolder);
        }
        self.status = JobStatus::Idle;
        Ok(())
    }

    /// Whether the job may be edited: only a draft is.
    pub fn edit(&self) -> Result<(), Transition> {
        match self.status {
            JobStatus::Draft => Ok(()),
            _ => Err(Transition::NotDraft),
        }
    }

    /// `runner` starts a run: the job's first, or another over the last one's
    /// output, in the same folder. The last run's end, report and problem go;
    /// the lease starts now. A job runs once at a time.
    pub fn run(&mut self, runner: &str) -> Result<(), Transition> {
        match self.status {
            JobStatus::Draft => return Err(Transition::NeverRun),
            JobStatus::Running => return Err(Transition::AlreadyRunning),
            _ => {}
        }
        let now = now_iso8601();
        self.status = JobStatus::Running;
        self.runner = Some(runner.to_owned());
        self.started_at = Some(now.clone());
        self.heartbeat_at = Some(now);
        self.completed_at = None;
        self.problem = None;
        self.report = None;
        self.cancel_requested = false;
        Ok(())
    }

    /// What the runner reports, and only the runner: `running` renews the
    /// lease; an end records how the run ended, and dates it.
    pub fn report(
        &mut self,
        by: &str,
        status: JobStatus,
        report: Option<serde_json::Value>,
        problem: Option<serde_json::Value>,
    ) -> Result<(), Transition> {
        self.running()?;
        if self.runner.as_deref() != Some(by) {
            return Err(Transition::NotRunner);
        }
        let now = now_iso8601();
        match status {
            JobStatus::Draft | JobStatus::Idle => return Err(Transition::Backwards),
            JobStatus::Running => self.heartbeat_at = Some(now),
            JobStatus::Completed => {
                self.report = report;
                self.completed_at = Some(now);
            }
            JobStatus::Failed => {
                self.problem = problem;
                self.completed_at = Some(now);
            }
            JobStatus::Cancelled => self.completed_at = Some(now),
        }
        if status.has_ended() {
            self.cancel_requested = false;
        }
        self.status = status;
        Ok(())
    }

    /// Ask the run to stop: its runner may, and an admin. The runner reads it
    /// in the answer to its next report, aborts and reports `cancelled`; a
    /// runner gone silent is swept instead.
    pub fn stop(&mut self, caller: &Caller) -> Result<(), Transition> {
        self.running()?;
        if !self.may_stop(caller) {
            return Err(Transition::NotRunner);
        }
        self.cancel_requested = true;
        Ok(())
    }

    /// Whether a run is under way, or why not.
    fn running(&self) -> Result<(), Transition> {
        match self.status {
            JobStatus::Running => Ok(()),
            JobStatus::Draft => Err(Transition::NeverRun),
            JobStatus::Idle => Err(Transition::NotRunning),
            _ => Err(Transition::Ended),
        }
    }

    fn runs_for(&self, caller: &Caller) -> bool {
        self.runner.as_deref() == Some(caller.user_id.as_str())
    }

    fn may_stop(&self, caller: &Caller) -> bool {
        self.status == JobStatus::Running && (caller.holds(Role::Admin) || self.runs_for(caller))
    }

    /// The job as `caller` sees it: [`Job::can_modify`] and [`Job::can_stop`]
    /// filled in.
    pub fn seen_by(mut self, caller: &Caller) -> Self {
        self.can_modify = caller.may_modify(&self.provenance.created_by.id);
        self.can_stop = self.may_stop(caller);
        self
    }

    /// Whether `caller` may open its output for `access`: anyone reads it once
    /// the job has completed; only the runner writes it, while it runs.
    pub fn may(&self, access: Access, caller: &Caller) -> Result<(), Transition> {
        match (access, &self.status) {
            (Access::Read, JobStatus::Completed) => Ok(()),
            (Access::Read, _) => Err(Transition::NotCompleted),
            (Access::Write, JobStatus::Running) if self.runs_for(caller) => Ok(()),
            (Access::Write, JobStatus::Running) => Err(Transition::NotRunner),
            (Access::Write, status) if status.has_ended() => Err(Transition::Ended),
            (Access::Write, _) => Err(Transition::NotRunning),
        }
    }

    /// Whether it may be deleted: not while it runs.
    pub fn delete(&self) -> Result<(), Transition> {
        match self.status {
            JobStatus::Running => Err(Transition::StillRunning),
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
    /// A status a run never reports: a draft, or idle.
    Backwards,
    /// A draft is never run: it is submitted first.
    NeverRun,
    /// A run is under way already: a job runs once at a time.
    AlreadyRunning,
    /// Only the runner reports on its run and writes its output; only the
    /// runner or an admin stops it.
    NotRunner,
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
            Transition::AlreadyRunning => {
                Refusal::conflict(ErrorCode::JobAlreadyRunning, "The job is running already")
            }
            Transition::NotRunner => Refusal::forbidden(
                "Only whoever runs the job reports on it and writes its output; only they or an \
                 admin stop it",
            ),
            Transition::Ended => Refusal::conflict(ErrorCode::JobEnded, "The run has ended"),
            Transition::NotRunning => {
                Refusal::conflict(ErrorCode::JobNotRunning, "The job is not running")
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
    use crate::authentication::role::Roles;
    use serde_json::json;

    fn caller(sub: &str, role: &str) -> Caller {
        Caller {
            user_id: sub.into(),
            name: sub.into(),
            roles: Roles::from_claim([role]),
        }
    }

    fn draft(folder: Option<&str>) -> Job {
        Job::new(
            None,
            "sink".into(),
            folder.map(|f| JobFolder::parse(f).unwrap()),
            "x".into(),
            Actor::bootstrap(),
        )
    }

    fn idle() -> Job {
        let mut job = draft(Some("people"));
        job.submit().unwrap();
        job
    }

    fn running(by: &str) -> Job {
        let mut job = idle();
        job.run(by).unwrap();
        job
    }

    fn ended(status: JobStatus) -> Job {
        let mut job = running("u-1");
        job.report(
            "u-1",
            status,
            Some(json!({"dest": "d"})),
            Some(json!({"code": "c"})),
        )
        .unwrap();
        job
    }

    #[test]
    fn the_output_lands_in_the_folder_under_the_sink() {
        let sink = StorageLocation::parse("s3://b/output/").unwrap();
        assert_eq!(
            draft(Some("people"))
                .output_under(&sink)
                .unwrap()
                .to_string(),
            "s3://b/output/people/"
        );
        assert_eq!(draft(None).output_under(&sink), None);
    }

    #[test]
    fn a_draft_is_edited_and_submitted_with_a_folder_and_waits_idle() {
        let mut unfiled = draft(None);
        assert_eq!(unfiled.edit(), Ok(()));
        assert_eq!(unfiled.submit(), Err(Transition::NoFolder));
        assert_eq!(unfiled.status, JobStatus::Draft);

        let job = idle();
        assert_eq!(job.status, JobStatus::Idle);
        assert_eq!(job.heartbeat_at, None, "nothing holds an idle job");
        assert_eq!(job.edit(), Err(Transition::NotDraft));
        assert_eq!(idle().submit(), Err(Transition::NotDraft));
    }

    #[test]
    fn a_draft_is_never_run_nor_reported_on() {
        let mut job = draft(Some("people"));
        assert_eq!(job.run("u-1"), Err(Transition::NeverRun));
        assert_eq!(
            job.report("u-1", JobStatus::Running, None, None),
            Err(Transition::NeverRun)
        );
        assert_eq!(job.stop(&caller("u-1", "admin")), Err(Transition::NeverRun));
    }

    #[test]
    fn running_takes_the_lease_for_the_runner_once_at_a_time() {
        let job = running("u-2");
        assert_eq!(job.status, JobStatus::Running);
        assert_eq!(job.runner.as_deref(), Some("u-2"));
        assert!(job.started_at.is_some() && job.heartbeat_at.is_some());
        assert_eq!(running("u-2").run("u-3"), Err(Transition::AlreadyRunning));
    }

    #[test]
    fn every_end_runs_again_clearing_the_last_run() {
        for status in [
            JobStatus::Completed,
            JobStatus::Failed,
            JobStatus::Cancelled,
        ] {
            let mut job = ended(status.clone());
            assert!(job.completed_at.is_some(), "{status:?} is dated");
            job.run("u-9").unwrap();
            assert_eq!(job.status, JobStatus::Running);
            assert_eq!(job.runner.as_deref(), Some("u-9"));
            assert_eq!(
                (&job.completed_at, &job.report, &job.problem),
                (&None, &None, &None),
                "{status:?}: the last run's end goes"
            );
            assert_eq!(job.folder.as_deref(), Some("people"), "the same folder");
        }
    }

    #[test]
    fn only_the_runner_reports_and_only_forward() {
        let mut job = running("u-1");
        assert_eq!(
            job.report("u-2", JobStatus::Running, None, None),
            Err(Transition::NotRunner)
        );
        for back in [JobStatus::Draft, JobStatus::Idle] {
            assert_eq!(
                job.report("u-1", back, None, None),
                Err(Transition::Backwards)
            );
        }
        assert_eq!(job.report("u-1", JobStatus::Running, None, None), Ok(()));

        let done = ended(JobStatus::Completed);
        assert_eq!(done.report, Some(json!({"dest": "d"})));
        assert_eq!(done.problem, None);
        let failed = ended(JobStatus::Failed);
        assert_eq!(failed.problem, Some(json!({"code": "c"})));
        assert_eq!(
            ended(JobStatus::Cancelled).report("u-1", JobStatus::Running, None, None),
            Err(Transition::Ended)
        );
        assert_eq!(
            idle().report("u-1", JobStatus::Running, None, None),
            Err(Transition::NotRunning)
        );
    }

    #[test]
    fn a_run_is_stopped_by_its_runner_or_an_admin() {
        let mut job = running("u-1");
        assert_eq!(
            job.stop(&caller("u-2", "editor")),
            Err(Transition::NotRunner)
        );
        assert!(!job.cancel_requested);
        job.stop(&caller("u-1", "editor")).unwrap();
        assert!(job.cancel_requested);

        let mut job = running("u-1");
        job.stop(&caller("u-9", "admin")).unwrap();
        assert!(job.cancel_requested);
        job.report("u-1", JobStatus::Cancelled, None, None).unwrap();
        assert!(!job.cancel_requested, "an end answers the request");

        assert_eq!(
            idle().stop(&caller("u-1", "admin")),
            Err(Transition::NotRunning)
        );
        assert_eq!(
            ended(JobStatus::Completed).stop(&caller("u-1", "admin")),
            Err(Transition::Ended)
        );
    }

    #[test]
    fn who_may_stop_is_drawn_for_each_caller() {
        let job = running("u-1");
        assert!(job.clone().seen_by(&caller("u-1", "editor")).can_stop);
        assert!(job.clone().seen_by(&caller("u-9", "admin")).can_stop);
        assert!(!job.seen_by(&caller("u-2", "editor")).can_stop);
        assert!(!idle().seen_by(&caller("u-9", "admin")).can_stop);
    }

    #[test]
    fn the_output_is_read_once_completed_and_written_by_the_runner_while_running() {
        let me = caller("u-1", "editor");
        let them = caller("u-2", "admin");
        assert_eq!(idle().may(Access::Read, &me), Err(Transition::NotCompleted));
        assert_eq!(ended(JobStatus::Completed).may(Access::Read, &them), Ok(()));
        assert_eq!(idle().may(Access::Write, &me), Err(Transition::NotRunning));
        assert_eq!(running("u-1").may(Access::Write, &me), Ok(()));
        assert_eq!(
            running("u-1").may(Access::Write, &them),
            Err(Transition::NotRunner),
            "not even an admin writes another's run"
        );
        assert_eq!(
            ended(JobStatus::Failed).may(Access::Write, &me),
            Err(Transition::Ended)
        );
    }

    #[test]
    fn a_job_is_deleted_unless_it_runs() {
        assert_eq!(draft(None).delete(), Ok(()));
        assert_eq!(idle().delete(), Ok(()));
        assert_eq!(running("u-1").delete(), Err(Transition::StillRunning));
        assert_eq!(ended(JobStatus::Completed).delete(), Ok(()));
    }
}
