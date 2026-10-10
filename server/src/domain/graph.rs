use crate::authentication::permission::{Action, Can, Kind, Securable};
use crate::authentication::role::Caller;
use serde::{Deserialize, Serialize};

use super::{Access, Actor, GraphFolder, Provenance, ResourceName, StorageLocation, now_iso8601};
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
pub enum GraphStatus {
    /// Being written: edited, never run.
    Draft,
    /// Submitted, and nothing runs it: it waits for someone to run it.
    Idle,
    /// A browser runs it, and holds its lease: [`Graph::runner`]'s.
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl GraphStatus {
    /// Completed, failed or cancelled: the last run is over, and the graph may
    /// be run again.
    pub fn has_ended(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct Graph {
    pub id: String,
    pub status: GraphStatus,
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
    /// reports. A running graph whose lease lapses is swept as `graph/abandoned`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_at: Option<String>,
    /// Keycloak `sub` of who runs the graph, or ran it last: the one caller
    /// whose reports are taken, and the one vended its output to write.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runner: Option<Actor>,
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
    /// Who owns the graph — with an admin, the one who may change or delete
    /// it, and its rules and dashboard. Its creator, to begin with.
    pub owner: Actor,
    /// Who created the graph, and when. Taken from the token, never the body.
    #[serde(flatten)]
    pub provenance: Provenance,
    /// What the caller may do to it: run it (again) — any editor — and manage
    /// it — its owner or an admin. Worked out for each response: the
    /// interface draws what this says and does not re-derive it.
    pub can: Can,
    /// `can.manage`, under its old name.
    #[serde(default)]
    #[schema(deprecated)]
    pub can_modify: bool,
    /// Whether the caller may stop the run under way — its runner, the
    /// graph's owner or an admin — worked out for each response; false when
    /// nothing runs.
    #[serde(default)]
    pub can_stop: bool,
    /// The sink connection the output lands in, under `{sink.url}/{folder}`,
    /// reached with a credential vended from that connection's.
    pub sink_connection: String,
    /// The folder under the sink the output lands in. A draft may not have one
    /// yet; every other graph does, and no two of them share one in a sink.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<GraphFolder>)]
    pub folder: Option<String>,
    /// Where the output lands, `{sink}/{folder}/`, as the sink's URL spells
    /// it: worked out for each response; unset for a draft with no folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// The program every run of the graph runs.
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

impl Graph {
    /// A graph as it begins: a draft.
    pub fn new(
        name: Option<String>,
        sink_connection: String,
        folder: Option<GraphFolder>,
        script: String,
        created_by: Actor,
    ) -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        Self {
            status: GraphStatus::Draft,
            name: name.or_else(|| Some(id[..8].to_string())),
            started_at: None,
            completed_at: None,
            heartbeat_at: None,
            runner: None,
            cancel_requested: false,
            problem: None,
            owner: created_by.as_owner(),
            provenance: Provenance::created(created_by),
            sink_connection,
            folder: folder.map(GraphFolder::into_inner),
            output: None,
            script: Some(script),
            report: None,
            can: Can::default(),
            can_modify: false,
            can_stop: false,
            id,
        }
    }

    /// The draft becomes a graph to run: it needs a folder, and it waits, idle,
    /// for someone to run it.
    pub fn submit(&mut self) -> Result<(), Transition> {
        self.edit()?;
        if self.folder.is_none() {
            return Err(Transition::NoFolder);
        }
        self.status = GraphStatus::Idle;
        Ok(())
    }

    /// Whether the graph may be edited: only a draft is.
    pub fn edit(&self) -> Result<(), Transition> {
        match self.status {
            GraphStatus::Draft => Ok(()),
            _ => Err(Transition::NotDraft),
        }
    }

    /// `runner` starts a run: the graph's first, or another over the last one's
    /// output, in the same folder. The last run's end, report and problem go;
    /// the lease starts now. A graph runs once at a time.
    pub fn run(&mut self, runner: Actor) -> Result<(), Transition> {
        match self.status {
            GraphStatus::Draft => return Err(Transition::NeverRun),
            GraphStatus::Running => return Err(Transition::AlreadyRunning),
            _ => {}
        }
        let now = now_iso8601();
        self.status = GraphStatus::Running;
        self.runner = Some(runner);
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
        status: GraphStatus,
        report: Option<serde_json::Value>,
        problem: Option<serde_json::Value>,
    ) -> Result<(), Transition> {
        self.running()?;
        if !self.runs_for(by) {
            return Err(Transition::NotRunner);
        }
        let now = now_iso8601();
        match status {
            GraphStatus::Draft | GraphStatus::Idle => return Err(Transition::Backwards),
            GraphStatus::Running => self.heartbeat_at = Some(now),
            GraphStatus::Completed => {
                self.report = report;
                self.completed_at = Some(now);
            }
            GraphStatus::Failed => {
                self.problem = problem;
                self.completed_at = Some(now);
            }
            GraphStatus::Cancelled => self.completed_at = Some(now),
        }
        if status.has_ended() {
            self.cancel_requested = false;
        }
        self.status = status;
        Ok(())
    }

    /// Ask the run to stop: its runner may, its owner and an admin. The runner reads it
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
            GraphStatus::Running => Ok(()),
            GraphStatus::Draft => Err(Transition::NeverRun),
            GraphStatus::Idle => Err(Transition::NotRunning),
            _ => Err(Transition::Ended),
        }
    }

    fn runs_for(&self, sub: &str) -> bool {
        self.runner.as_ref().is_some_and(|r| r.id == sub)
    }

    /// Who may stop a run: its runner, and whoever manages the graph.
    fn may_stop(&self, caller: &Caller) -> bool {
        self.status == GraphStatus::Running
            && (self.runs_for(&caller.user_id) || caller.may(Action::Manage, self))
    }

    /// The graph as `caller` sees it: [`Graph::can`] and [`Graph::can_stop`]
    /// filled in.
    pub fn seen_by(mut self, caller: &Caller) -> Self {
        self.can = caller.can(&self);
        self.can_modify = self.can.manage;
        self.can_stop = self.may_stop(caller);
        self
    }

    /// Whether `caller` may open its output for `access`: anyone reads it once
    /// the graph has completed; only the runner writes it, while it runs.
    pub fn may(&self, access: Access, caller: &Caller) -> Result<(), Transition> {
        match (access, &self.status) {
            (Access::Read, GraphStatus::Completed) => Ok(()),
            (Access::Read, _) => Err(Transition::NotCompleted),
            (Access::Write, GraphStatus::Running) if self.runs_for(&caller.user_id) => Ok(()),
            (Access::Write, GraphStatus::Running) => Err(Transition::NotRunner),
            (Access::Write, status) if status.has_ended() => Err(Transition::Ended),
            (Access::Write, _) => Err(Transition::NotRunning),
        }
    }

    /// Whether it may be deleted: not while it runs.
    pub fn delete(&self) -> Result<(), Transition> {
        match self.status {
            GraphStatus::Running => Err(Transition::StillRunning),
            _ => Ok(()),
        }
    }

    /// Where the output lives: the sink, plus the folder the member chose;
    /// `None` for a draft that has none yet. **This is the one place keasy
    /// composes an output path**, and it is keasy's to compose — a graph's home
    /// is the host's decision, not the language's. Everything below it
    /// (table names, file names) belongs to fossil, and the corpus says it.
    pub fn output_under(&self, sink: &StorageLocation) -> Option<StorageLocation> {
        self.folder.as_deref().map(|folder| sink.child(folder))
    }
}

impl Securable for Graph {
    fn kind(&self) -> Kind {
        Kind::Graph
    }

    fn owner(&self) -> &Actor {
        &self.owner
    }
}

/// Why a graph's state does not allow what was asked: the one table of a graph's
/// moves, said on the wire through [`Refusal`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transition {
    NotDraft,
    NoFolder,
    /// A status a run never reports: a draft, or idle.
    Backwards,
    /// A draft is never run: it is submitted first.
    NeverRun,
    /// A run is under way already: a graph runs once at a time.
    AlreadyRunning,
    /// Only the runner reports on its run and writes its output; only the
    /// runner, the graph's owner or an admin stops it.
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
                ErrorCode::GraphNotDraft,
                "Only a draft is edited or submitted",
            ),
            Transition::NoFolder => {
                Refusal::invalid_field("folder", "A graph to run needs a folder for its output")
            }
            Transition::Backwards => {
                Refusal::invalid("A run reports running, completed, failed or cancelled")
            }
            Transition::NeverRun => Refusal::invalid("A draft is never run: submit it first"),
            Transition::AlreadyRunning => Refusal::conflict(
                ErrorCode::GraphAlreadyRunning,
                "The graph is running already",
            ),
            Transition::NotRunner => Refusal::forbidden(
                "Only whoever runs the graph reports on it and writes its output; only they, its \
                 owner or an admin stop it",
            ),
            Transition::Ended => Refusal::conflict(ErrorCode::GraphEnded, "The run has ended"),
            Transition::NotRunning => {
                Refusal::conflict(ErrorCode::GraphNotRunning, "The graph is not running")
            }
            Transition::NotCompleted => Refusal::conflict(
                ErrorCode::GraphNotCompleted,
                "The graph has not completed, so it has no output to read",
            ),
            Transition::StillRunning => Refusal::conflict(
                ErrorCode::GraphStillRunning,
                "Cannot delete a graph that is still running",
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

    fn actor(sub: &str) -> Actor {
        Actor {
            id: sub.into(),
            name: sub.into(),
        }
    }

    /// A draft `u-owner` made.
    fn draft(folder: Option<&str>) -> Graph {
        Graph::new(
            None,
            "sink".into(),
            folder.map(|f| GraphFolder::parse(f).unwrap()),
            "x".into(),
            actor("u-owner"),
        )
    }

    fn idle() -> Graph {
        let mut graph = draft(Some("people"));
        graph.submit().unwrap();
        graph
    }

    fn running(by: &str) -> Graph {
        let mut graph = idle();
        graph.run(actor(by)).unwrap();
        graph
    }

    fn ended(status: GraphStatus) -> Graph {
        let mut graph = running("u-1");
        graph
            .report(
                "u-1",
                status,
                Some(json!({"dest": "d"})),
                Some(json!({"code": "c"})),
            )
            .unwrap();
        graph
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
        assert_eq!(unfiled.status, GraphStatus::Draft);

        let graph = idle();
        assert_eq!(graph.status, GraphStatus::Idle);
        assert_eq!(graph.heartbeat_at, None, "nothing holds an idle graph");
        assert_eq!(graph.edit(), Err(Transition::NotDraft));
        assert_eq!(idle().submit(), Err(Transition::NotDraft));
    }

    #[test]
    fn a_draft_is_never_run_nor_reported_on() {
        let mut graph = draft(Some("people"));
        assert_eq!(graph.run(actor("u-1")), Err(Transition::NeverRun));
        assert_eq!(
            graph.report("u-1", GraphStatus::Running, None, None),
            Err(Transition::NeverRun)
        );
        assert_eq!(
            graph.stop(&caller("u-1", "admin")),
            Err(Transition::NeverRun)
        );
    }

    #[test]
    fn running_takes_the_lease_for_the_runner_once_at_a_time() {
        let graph = running("u-2");
        assert_eq!(graph.status, GraphStatus::Running);
        assert_eq!(graph.runner, Some(actor("u-2")));
        assert!(graph.started_at.is_some() && graph.heartbeat_at.is_some());
        assert_eq!(
            running("u-2").run(actor("u-3")),
            Err(Transition::AlreadyRunning)
        );
    }

    #[test]
    fn every_end_runs_again_clearing_the_last_run() {
        for status in [
            GraphStatus::Completed,
            GraphStatus::Failed,
            GraphStatus::Cancelled,
        ] {
            let mut graph = ended(status.clone());
            assert!(graph.completed_at.is_some(), "{status:?} is dated");
            graph.run(actor("u-9")).unwrap();
            assert_eq!(graph.status, GraphStatus::Running);
            assert_eq!(graph.runner, Some(actor("u-9")));
            assert_eq!(
                (&graph.completed_at, &graph.report, &graph.problem),
                (&None, &None, &None),
                "{status:?}: the last run's end goes"
            );
            assert_eq!(graph.folder.as_deref(), Some("people"), "the same folder");
        }
    }

    #[test]
    fn only_the_runner_reports_and_only_forward() {
        let mut graph = running("u-1");
        assert_eq!(
            graph.report("u-2", GraphStatus::Running, None, None),
            Err(Transition::NotRunner)
        );
        for back in [GraphStatus::Draft, GraphStatus::Idle] {
            assert_eq!(
                graph.report("u-1", back, None, None),
                Err(Transition::Backwards)
            );
        }
        assert_eq!(
            graph.report("u-1", GraphStatus::Running, None, None),
            Ok(())
        );

        let done = ended(GraphStatus::Completed);
        assert_eq!(done.report, Some(json!({"dest": "d"})));
        assert_eq!(done.problem, None);
        let failed = ended(GraphStatus::Failed);
        assert_eq!(failed.problem, Some(json!({"code": "c"})));
        assert_eq!(
            ended(GraphStatus::Cancelled).report("u-1", GraphStatus::Running, None, None),
            Err(Transition::Ended)
        );
        assert_eq!(
            idle().report("u-1", GraphStatus::Running, None, None),
            Err(Transition::NotRunning)
        );
    }

    /// Another editor runs the owner's graph (operate); the owner stops that
    /// run (manage), as its runner and an admin may.
    #[test]
    fn a_run_is_stopped_by_its_runner_the_graphs_owner_or_an_admin() {
        let mut graph = running("u-1");
        graph.stop(&caller("u-owner", "editor")).unwrap();
        assert!(graph.cancel_requested);
        assert!(
            running("u-1")
                .seen_by(&caller("u-owner", "editor"))
                .can_stop
        );
    }

    #[test]
    fn a_run_is_stopped_by_its_runner_or_an_admin() {
        let mut graph = running("u-1");
        assert_eq!(
            graph.stop(&caller("u-2", "editor")),
            Err(Transition::NotRunner)
        );
        assert!(!graph.cancel_requested);
        graph.stop(&caller("u-1", "editor")).unwrap();
        assert!(graph.cancel_requested);

        let mut graph = running("u-1");
        graph.stop(&caller("u-9", "admin")).unwrap();
        assert!(graph.cancel_requested);
        graph
            .report("u-1", GraphStatus::Cancelled, None, None)
            .unwrap();
        assert!(!graph.cancel_requested, "an end answers the request");

        assert_eq!(
            idle().stop(&caller("u-1", "admin")),
            Err(Transition::NotRunning)
        );
        assert_eq!(
            ended(GraphStatus::Completed).stop(&caller("u-1", "admin")),
            Err(Transition::Ended)
        );
    }

    #[test]
    fn who_may_stop_is_drawn_for_each_caller() {
        let graph = running("u-1");
        assert!(graph.clone().seen_by(&caller("u-1", "editor")).can_stop);
        assert!(graph.clone().seen_by(&caller("u-9", "admin")).can_stop);
        assert!(!graph.seen_by(&caller("u-2", "editor")).can_stop);
        assert!(!idle().seen_by(&caller("u-9", "admin")).can_stop);
    }

    #[test]
    fn the_output_is_read_once_completed_and_written_by_the_runner_while_running() {
        let me = caller("u-1", "editor");
        let them = caller("u-2", "admin");
        assert_eq!(idle().may(Access::Read, &me), Err(Transition::NotCompleted));
        assert_eq!(
            ended(GraphStatus::Completed).may(Access::Read, &them),
            Ok(())
        );
        assert_eq!(idle().may(Access::Write, &me), Err(Transition::NotRunning));
        assert_eq!(running("u-1").may(Access::Write, &me), Ok(()));
        assert_eq!(
            running("u-1").may(Access::Write, &them),
            Err(Transition::NotRunner),
            "not even an admin writes another's run"
        );
        assert_eq!(
            ended(GraphStatus::Failed).may(Access::Write, &me),
            Err(Transition::Ended)
        );
    }

    #[test]
    fn a_graph_is_deleted_unless_it_runs() {
        assert_eq!(draft(None).delete(), Ok(()));
        assert_eq!(idle().delete(), Ok(()));
        assert_eq!(running("u-1").delete(), Err(Transition::StillRunning));
        assert_eq!(ended(GraphStatus::Completed).delete(), Ok(()));
    }
}
