pub mod dashboard;
pub mod rules;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::{Editor, Reader};
use crate::domain::{Graph, GraphFolder, GraphStatus, ResourceName};
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::graphs::{any, changeable, persistence, present, transition};
use crate::startup::AppState;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateGraphRequest {
    pub script: String,
    #[schema(value_type = Option<ResourceName>)]
    pub name: Option<String>,
    /// Where the output lands: the sink connection's name.
    pub sink_connection: String,
    /// The folder under the sink the output lands in. A draft may leave it
    /// out; it needs one, no other graph's, to be submitted.
    #[schema(value_type = Option<GraphFolder>)]
    pub folder: Option<String>,
}

/// Edits to a draft: as it is written (PATCH), and as it is submitted.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct DraftEdits {
    pub script: Option<String>,
    #[schema(value_type = Option<ResourceName>)]
    pub name: Option<String>,
    /// The draft's folder under the sink, spelled as on create. Submitting
    /// needs one, unless the draft holds one already.
    #[schema(value_type = Option<GraphFolder>)]
    pub folder: Option<String>,
}

impl DraftEdits {
    /// Checked, then applied to `graph`.
    fn apply(self, graph: &mut Graph) -> Result<(), Refusal> {
        let name = name(self.name)?;
        let folder = folder(self.folder.as_deref())?;
        if let Some(script) = self.script {
            graph.script = Some(script);
        }
        if let Some(name) = name {
            graph.name = Some(name);
        }
        if let Some(folder) = folder {
            graph.folder = Some(folder.into_inner());
        }
        Ok(())
    }
}

/// The folder a request names, parsed.
fn folder(folder: Option<&str>) -> Result<Option<GraphFolder>, Refusal> {
    folder
        .map(GraphFolder::parse)
        .transpose()
        .map_err(|e| Refusal::invalid_field("folder", e))
}

/// The name a request gives the graph, checked: a graph is named as a connection is.
fn name(name: Option<String>) -> Result<Option<String>, Refusal> {
    if let Some(name) = &name {
        ResourceName::parse(name).map_err(|e| Refusal::invalid_field("name", e))?;
    }
    Ok(name)
}

/// What the runner reports of a graph's run (POST `/v1/graphs/{id}/status`): that
/// it still runs, every so often to hold its lease, and how it ended. The
/// browser runs the program (`@fossil-lang/executor`) and writes the output
/// with a credential vended for the graph; keasy only records.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct GraphStatusReport {
    /// `running` (renews the lease), or the end: `completed`, `failed` or
    /// `cancelled`.
    pub status: GraphStatus,
    /// fossil's run report (on `completed`), stored verbatim and never read.
    #[serde(default)]
    #[schema(value_type = Option<Value>)]
    pub report: Option<serde_json::Value>,
    /// Why the run failed (on `failed`): the run's problem, stored verbatim
    /// and opaque.
    #[serde(default)]
    #[schema(value_type = Option<Value>)]
    pub problem: Option<serde_json::Value>,
}

/// What a report is answered with: whether the run is asked to stop. A runner
/// told so aborts and reports `cancelled`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct RunSignal {
    pub cancel_requested: bool,
}

#[utoipa::path(get, path = "/v1/graphs", tag = "Graphs", security(("bearer" = ["reader"])),
    responses(
        (status = 200, description = "Every graph in the workspace", body = Vec<Graph>),
    )
)]
pub async fn list_graphs(
    caller: Reader,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Refusal> {
    crate::graphs::sweep(&state.db).await?;
    let conn = state.db.read().await;
    let graphs = persistence::list(&conn)?
        .into_iter()
        .map(|graph| present(&conn, &caller, graph))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(graphs))
}

#[utoipa::path(post, path = "/v1/graphs", tag = "Graphs", security(("bearer" = ["editor"])),
    request_body = CreateGraphRequest,
    responses(
        (status = 201, description = "The draft, created; `POST /v1/graphs/{id}/submit` makes it a graph to run", body = Graph),
        (status = 400, description = "The destination is not a sink, or the name or folder is misspelled (`data.field`)", body = ErrorBody),
    )
)]
/// A graph begins as a draft, always: what it runs, where it lands. Submitting
/// it makes it a graph to run; running it is asked for on its own.
pub async fn create_graph(
    caller: Editor,
    State(state): State<AppState>,
    Json(payload): Json<CreateGraphRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let is_sink =
        crate::connections::persistence::get(&*state.db.read().await, &payload.sink_connection)?
            .is_some_and(|c| c.target.is_sink());
    if !is_sink {
        return Err(Refusal::new(
            StatusCode::BAD_REQUEST,
            ErrorCode::GraphInvalidDestination,
            "sink_connection must name the workspace sink",
        ));
    }

    let graph = Graph::new(
        name(payload.name)?,
        payload.sink_connection,
        folder(payload.folder.as_deref())?,
        payload.script,
        caller.actor(),
    );
    persistence::insert(&*state.db.write().await, &graph)?;

    let graph = present(&*state.db.read().await, &caller, graph)?;
    Ok((StatusCode::CREATED, Json(graph)))
}

#[utoipa::path(get, path = "/v1/graphs/{id}", tag = "Graphs", security(("bearer" = ["reader"])),
    params(("id" = String, Path, description = "Graph ID")),
    responses(
        (status = 200, description = "Graph details", body = Graph),
        (status = 404, description = "Graph not found", body = ErrorBody),
    )
)]
pub async fn get_graph(
    caller: Reader,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    crate::graphs::sweep(&state.db).await?;
    let conn = state.db.read().await;
    Ok(Json(present(&conn, &caller, any(&conn, &id)?)?))
}

#[utoipa::path(patch, path = "/v1/graphs/{id}", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    request_body = DraftEdits,
    responses(
        (status = 200, description = "The draft, edited", body = Graph),
        (status = 400, description = "The name or folder is misspelled (`data.field`)", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 409, description = "Not a draft: `graph/not-draft`", body = ErrorBody),
    )
)]
pub async fn edit_draft(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(edits): Json<DraftEdits>,
) -> Result<impl IntoResponse, Refusal> {
    changeable(&*state.db.read().await, &caller, &id)?;
    let graph = transition(&state.db, &id, |graph| {
        graph.edit()?;
        edits.clone().apply(graph)
    })
    .await?;
    Ok(Json(present(&*state.db.read().await, &caller, graph)?))
}

#[utoipa::path(post, path = "/v1/graphs/{id}/submit", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    request_body = DraftEdits,
    responses(
        (status = 200, description = "The draft is now a graph to run, idle, under the same id", body = Graph),
        (status = 400, description = "The name or folder is missing or misspelled (`data.field`)", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 409, description = "Not a draft (`graph/not-draft`), or another graph writes to that folder already (`graph/folder-taken`; the graph stays a draft, unchanged)", body = ErrorBody),
    )
)]
/// A draft becomes a graph to run, in place: the edits, the folder check and
/// the promotion are one write, so a refusal leaves the draft as it was and a
/// success leaves no draft behind. It waits `idle` until someone runs it.
pub async fn submit_graph(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(edits): Json<DraftEdits>,
) -> Result<impl IntoResponse, Refusal> {
    changeable(&*state.db.read().await, &caller, &id)?;
    let graph = transition(&state.db, &id, |graph| {
        graph.edit()?;
        edits.clone().apply(graph)?;
        Ok(graph.submit()?)
    })
    .await?;
    Ok(Json(present(&*state.db.read().await, &caller, graph)?))
}

#[utoipa::path(post, path = "/v1/graphs/{id}/run", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    responses(
        (status = 200, description = "The graph runs, and the caller is its runner: the browser that asked runs the program and reports on it", body = Graph),
        (status = 400, description = "A draft, which is submitted before it runs", body = ErrorBody),
        (status = 403, description = "Neither its creator nor an admin (`rbac/forbidden`)", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 409, description = "It runs already (`graph/already-running`)", body = ErrorBody),
    )
)]
/// Start a run, with the caller as its runner: of a graph never run, or again —
/// over the last run's output, in the same folder. One compare-and-set on the
/// stored status, so of two runs asked at once one starts and the other is
/// `graph/already-running`. The run's lease starts now.
pub async fn run_graph(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    crate::graphs::sweep(&state.db).await?;
    changeable(&*state.db.read().await, &caller, &id)?;
    let graph = transition(&state.db, &id, |graph| Ok(graph.run(caller.actor())?)).await?;
    Ok(Json(present(&*state.db.read().await, &caller, graph)?))
}

#[utoipa::path(post, path = "/v1/graphs/{id}/status", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    request_body = GraphStatusReport,
    responses(
        (status = 200, description = "Recorded: the lease renewed, or the run's end; and whether the run is asked to stop", body = RunSignal),
        (status = 400, description = "The status is not running or an end, or the graph is a draft", body = ErrorBody),
        (status = 403, description = "Not the graph's runner (`rbac/forbidden`)", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 409, description = "Nothing runs (`graph/not-running`), or the run has ended (`graph/ended`): the sweep's `graph/abandoned` among them", body = ErrorBody),
    )
)]
/// The runner's one report, taken from the runner alone: `running` renews the
/// lease — a run no report has renewed for the lease (60 s) is swept as
/// `graph/abandoned`; an end records how the run ended, and dates it.
/// `completed` stores the run report verbatim, unread. The answer says
/// whether someone asked the run to stop.
pub async fn report_status(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<GraphStatusReport>,
) -> Result<Json<RunSignal>, Refusal> {
    // The beat, every 15 s of every run: one statement, for the runner's run.
    // Anything else — an end, a lease that lapsed, someone not the runner —
    // reads the graph and moves it, or says why not.
    let now = jiff::Timestamp::now();
    if payload.status == GraphStatus::Running
        && let Some(cancel_requested) =
            persistence::renew(&*state.db.write().await, &id, &caller.user_id, now)?
    {
        return Ok(Json(RunSignal { cancel_requested }));
    }
    crate::graphs::sweep(&state.db).await?;
    let graph = transition(&state.db, &id, |graph| {
        Ok(graph.report(
            &caller.user_id,
            payload.status.clone(),
            payload.report.clone(),
            payload.problem.clone(),
        )?)
    })
    .await?;
    Ok(Json(RunSignal {
        cancel_requested: graph.cancel_requested,
    }))
}

#[utoipa::path(post, path = "/v1/graphs/{id}/stop", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    responses(
        (status = 200, description = "The run is asked to stop: its runner aborts on its next report and reports `cancelled`", body = Graph),
        (status = 403, description = "Neither its runner nor an admin (`rbac/forbidden`)", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 409, description = "Nothing runs (`graph/not-running`), or the run has ended (`graph/ended`)", body = ErrorBody),
    )
)]
/// Ask a run to stop, from wherever it is watched: its runner may, and an
/// admin. Cooperative — the browser running it hears it in the answer to its
/// next report and ends the run `cancelled`; if that browser is gone, the
/// sweep ends it `graph/abandoned` once the lease lapses.
pub async fn stop_graph(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    crate::graphs::sweep(&state.db).await?;
    let graph = transition(&state.db, &id, |graph| Ok(graph.stop(&caller)?)).await?;
    Ok(Json(present(&*state.db.read().await, &caller, graph)?))
}

#[utoipa::path(delete, path = "/v1/graphs/{id}", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    responses(
        (status = 204, description = "Graph deleted"),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 409, description = "Graph is still running", body = ErrorBody),
    )
)]
pub async fn delete_graph(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    crate::graphs::sweep(&state.db).await?;
    changeable(&*state.db.read().await, &caller, &id)?.delete()?;

    persistence::delete(&*state.db.write().await, &id)?;
    Ok(StatusCode::NO_CONTENT)
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_graphs, create_graph))
        .routes(routes!(get_graph, edit_draft, delete_graph))
        .routes(routes!(submit_graph))
        .routes(routes!(run_graph))
        .routes(routes!(report_status))
        .routes(routes!(stop_graph))
}
