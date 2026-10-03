use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::Owner;
use crate::domain::{JobStatus, StorageLocation};
use crate::error::Refusal;
use crate::jobs::persistence;
use crate::startup::AppState;

/// A completed job's output: where its corpus is, and when it was written.
/// What the corpus holds is the corpus's own to say — a reader opens it (with
/// a credential vended for the job) and asks its `fossil_tables` and
/// `fossil_columns`; keasy keeps no copy of it.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Dataset {
    /// The job that wrote it, which is the scope its read credential is asked for.
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The corpus's root, `{sink}/{folder}/`.
    pub dest: String,
    pub completed_at: String,
}

#[utoipa::path(get, path = "/v1/datasets", tag = "Datasets",
    responses(
        (status = 200, description = "Every completed job's output, newest first", body = Vec<Dataset>),
    )
)]
/// Every dataset the workspace produced: the owner's index over the whole
/// workspace. The owner opens one by reading its job's corpus.
pub async fn list_datasets(
    _: Owner,
    State(state): State<AppState>,
) -> Result<Json<Vec<Dataset>>, Refusal> {
    crate::jobs::sweep(&state.db).await?;
    let conn = state.db.read().await;
    // The sink a job wrote to, by name: one per workspace, read once.
    let mut sinks = HashMap::new();
    let mut datasets = Vec::new();
    for job in persistence::completed(&conn)? {
        if job.status != JobStatus::Completed {
            continue;
        }
        if !sinks.contains_key(&job.sink_connection) {
            let sink = crate::connections::persistence::get(&conn, &job.sink_connection)?
                .and_then(|c| StorageLocation::parse(&c.target.url).ok());
            sinks.insert(job.sink_connection.clone(), sink);
        }
        let Some(dest) = sinks[&job.sink_connection]
            .as_ref()
            .and_then(|sink| job.output_under(sink))
        else {
            continue;
        };
        datasets.push(Dataset {
            dest: dest.to_string(),
            completed_at: job.completed_at.unwrap_or_default(),
            id: job.id,
            name: job.name,
        });
    }
    datasets.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));
    Ok(Json(datasets))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_datasets))
}
