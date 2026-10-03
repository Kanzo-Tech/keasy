use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::Reader;
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

#[utoipa::path(get, path = "/v1/datasets", tag = "Datasets", security(("bearer" = ["reader"])),
    responses(
        (status = 200, description = "Every completed job's output, newest first", body = Vec<Dataset>),
    )
)]
/// Every dataset the workspace produced, for anyone in it: each is opened by
/// reading its job's corpus.
pub async fn list_datasets(
    _: Reader,
    State(state): State<AppState>,
) -> Result<Json<Vec<Dataset>>, Refusal> {
    let conn = state.db.read().await;
    // A completed job wrote to the workspace's one sink.
    let Some(sink) = crate::connections::persistence::sink(&conn)? else {
        return Ok(Json(Vec::new()));
    };
    let (sink_at, _) = crate::connections::storage(&conn, state.db.secret_key(), &sink)?;
    let datasets = persistence::completed(&conn)?
        .into_iter()
        .filter(|job| job.sink_connection == sink.name)
        .filter_map(|job| {
            Some(Dataset {
                dest: job.output_under(&sink_at)?.to_string(),
                completed_at: job.completed_at.unwrap_or_default(),
                id: job.id,
                name: job.name,
            })
        })
        .collect();
    Ok(Json(datasets))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_datasets))
}
