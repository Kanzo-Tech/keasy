pub mod dashboards;
pub mod persistence;
pub mod rules;

use axum::http::StatusCode;
use rusqlite::Connection;

use crate::authentication::permission::Action;
use crate::authentication::role::Caller;
use crate::credentials::sealing::SecretKey;
use crate::database::Database;
use crate::domain::{Graph, SecretSpec, StorageLocation};
use crate::error::{ErrorCode, Refusal};

/// End the graphs no runner holds ([`persistence::sweep`]). Every read of graphs
/// calls it first, so no one is ever shown a run that has stopped as running.
pub async fn sweep(db: &Database) -> Result<(), Refusal> {
    let swept = persistence::sweep(&*db.write().await, jiff::Timestamp::now())?;
    if swept > 0 {
        tracing::info!(swept, "graphs abandoned by their runner marked failed");
    }
    Ok(())
}

/// The graph, whoever created it: everyone in the workspace reads it. Not swept:
/// a caller whose answer turns on whether a run is still held sweeps first.
pub fn any(conn: &Connection, id: &str) -> Result<Graph, Refusal> {
    persistence::get(conn, id)?
        .ok_or_else(|| Refusal::not_found(ErrorCode::GraphNotFound, "No such graph"))
}

/// The graph, if `caller` may take `action` on it: run it (operate, any
/// editor), or change it, its rules and its dashboard (manage, its owner or an
/// admin). Refused with `rbac/forbidden`, not a 404, for a graph everyone can
/// see exists.
pub fn permitted(
    conn: &Connection,
    caller: &Caller,
    id: &str,
    action: Action,
) -> Result<Graph, Refusal> {
    let graph = any(conn, id)?;
    caller.ensure(action, &graph)?;
    Ok(graph)
}

/// The graph as `caller` is shown it: who may change and stop it, and where its
/// output lands — as the sink's URL spells it, without reaching for the
/// sink's secret.
pub fn present(conn: &Connection, caller: &Caller, mut graph: Graph) -> Result<Graph, Refusal> {
    let sink = crate::connections::persistence::get(conn, &graph.sink_connection)?;
    graph.output = sink
        .and_then(|sink| StorageLocation::parse(&sink.target.url).ok())
        .and_then(|sink| graph.output_under(&sink))
        .map(|output| output.to_string());
    Ok(graph.seen_by(caller))
}

/// Move graph `id` as `step` says, from what is stored: read it, step it, and
/// write it back only if no one moved it meanwhile; if someone did, step what
/// they left. `step` refuses what the state no longer allows — the second of
/// two runs started at once meets the first's `running`.
pub async fn transition(
    db: &Database,
    id: &str,
    mut step: impl FnMut(&mut Graph) -> Result<(), Refusal>,
) -> Result<Graph, Refusal> {
    for _ in 0..3 {
        let was = any(&*db.read().await, id)?;
        let mut graph = was.clone();
        step(&mut graph)?;
        if persistence::write(&*db.write().await, &graph, &was)? {
            return Ok(graph);
        }
    }
    tracing::warn!(
        graph = id,
        "a graph kept moving under three tries to move it"
    );
    Err(Refusal::internal())
}

/// Where `graph`'s corpus lives, `{sink}/{folder}/`, as the sink's secret
/// reaches it, and that secret.
pub fn output(
    conn: &Connection,
    key: &SecretKey,
    graph: &Graph,
) -> Result<(StorageLocation, SecretSpec), Refusal> {
    let sink =
        crate::connections::persistence::get(conn, &graph.sink_connection)?.ok_or_else(|| {
            Refusal::new(
                StatusCode::BAD_REQUEST,
                ErrorCode::GraphNoDestination,
                "The graph's destination connection no longer exists",
            )
        })?;
    let (sink, spec) = crate::connections::storage(conn, key, &sink)?;
    // Only a draft has no folder, and a draft has no output.
    let output = graph
        .output_under(&sink)
        .ok_or_else(|| Refusal::invalid("The graph has no output folder"))?;
    Ok((output, spec))
}
