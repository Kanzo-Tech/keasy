use axum::Json;
use axum::extract::State;
use keasy_api::jobs::{Dataset, JobStatus};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::errors::JobApiError;
use crate::AppState;
use crate::auth::role::Owner;

#[utoipa::path(get, path = "/v1/datasets", tag = "Jobs",
    responses(
        (status = 200, description = "Every completed job's output", body = Vec<Dataset>),
    )
)]
/// Every dataset the workspace produced, as the corpus reader named it: the
/// owner's index over the whole workspace. It carries metadata only; the
/// member reaches the bytes through the job that made them.
pub async fn list_datasets(
    _: Owner,
    State(state): State<AppState>,
) -> Result<Json<Vec<Dataset>>, JobApiError> {
    let datasets = state
        .db
        .list_jobs()
        .await?
        .into_iter()
        .filter(|job| job.status == JobStatus::Completed && !job.relations.is_empty())
        .map(|job| Dataset {
            job_id: job.id,
            name: job.name,
            completed_at: job.completed_at,
            relations: job.relations,
        })
        .collect();
    Ok(Json(datasets))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_datasets))
}
