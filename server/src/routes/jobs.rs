use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::AppState;
use crate::dcat::generator::generate_dcat_catalog;
use crate::rdf::format::RdfExportFormat;
use crate::job::types::{CreateJobRequest, Job, JobStatus, RunMode, now_iso8601};

use super::error_response;

pub async fn list_jobs(State(state): State<AppState>) -> impl IntoResponse {
    let mut jobs = state.store.list_all();
    jobs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Json(jobs)
}

pub async fn create_job(
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> impl IntoResponse {
    let id = uuid::Uuid::new_v4().to_string();
    let dcat_enabled = payload.dcat_enabled.unwrap_or(false);

    let job = Job {
        id: id.clone(),
        status: JobStatus::Pending,
        name: payload.name.or_else(|| Some(id[..8].to_string())),
        created_at: now_iso8601(),
        started_at: None,
        completed_at: None,
        error: None,
        mode: payload.mode.unwrap_or(RunMode::Integrated),
        sources: payload.sources.unwrap_or_default(),
        outputs: payload.outputs.unwrap_or_default(),
        catalog: None,
        dcat_input: None,
        cloud_account_ids: payload.cloud_account_ids.clone(),
    };

    state.store.insert(job.clone());

    let org_settings = if dcat_enabled {
        state.org_settings.read()
    } else {
        None
    };

    state.runner.spawn(
        id,
        payload.script,
        payload.cloud_account_ids,
        org_settings,
        dcat_enabled,
        payload.dcat_format,
    );

    (StatusCode::ACCEPTED, Json(job))
}

pub async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.store.get(&id) {
        Some(job) => (StatusCode::OK, Json(job)).into_response(),
        None => not_found(&id),
    }
}

pub async fn cancel_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.store.update(&id, |job| {
        job.status = JobStatus::Cancelled;
        job.completed_at = Some(now_iso8601());
    }) {
        Some(job) => (StatusCode::OK, Json(job)).into_response(),
        None => not_found(&id),
    }
}

pub async fn delete_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    // Check job exists
    if state.store.get(&id).is_none() {
        return not_found(&id);
    }

    // Clear named graph from catalog
    let graph_name = format!("urn:keasy:job:{id}");
    state.catalog.clear_named_graph(&graph_name);

    {
        let mut cache = state.output_cache.lock().await;
        cache.remove(&id);
    }

    // Remove job from store
    state.store.remove(&id);

    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize)]
pub struct CatalogQuery {
    pub format: Option<String>,
}

pub async fn get_job_catalog(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<CatalogQuery>,
) -> Response {
    let job = match state.store.get(&id) {
        Some(job) => job,
        None => return not_found(&id),
    };

    let dcat_input = match &job.dcat_input {
        Some(input) => input,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "no_catalog",
                "No DCAT catalog available for this job",
            )
        }
    };

    let format = match query
        .format
        .as_deref()
        .map(RdfExportFormat::from_name)
        .transpose()
    {
        Ok(f) => f.unwrap_or(RdfExportFormat::Turtle),
        Err(err) => {
            return error_response(StatusCode::BAD_REQUEST, "invalid_format", err)
        }
    };

    match generate_dcat_catalog(dcat_input, format) {
        Ok(catalog) => (StatusCode::OK, Json(serde_json::json!({ "catalog": catalog }))).into_response(),
        Err(err) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "serialization_error", err),
    }
}

pub async fn get_job_graph(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.store.get(&id) {
        Some(_) => {
            let graph_name = format!("urn:keasy:job:{id}");
            let graph_data = state.catalog.get_graph(Some(&graph_name));
            (StatusCode::OK, Json(graph_data)).into_response()
        }
        None => not_found(&id),
    }
}

pub async fn get_unified_graph(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let graph_data = state.catalog.get_graph(None);
    Json(graph_data)
}

fn not_found(id: &str) -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        "not_found",
        format!("Job '{}' not found", id),
    )
}
