use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::AppState;
use crate::rdf::format::RdfExportFormat;
use crate::job::types::{CreateJobRequest, Job, JobStatus, RunMode, UpdateJobRequest, now_iso8601};
use crate::script::rewrite;

use super::error_response;

pub async fn list_jobs(State(state): State<AppState>) -> impl IntoResponse {
    let jobs = state.db.list_jobs().await;
    Json(jobs)
}

pub async fn create_job(
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> Response {
    let id = uuid::Uuid::new_v4().to_string();

    if payload.draft {
        let job = Job {
            id: id.clone(),
            status: JobStatus::Draft,
            name: payload.name.or_else(|| Some(id[..8].to_string())),
            created_at: now_iso8601(),
            started_at: None,
            completed_at: None,
            error: None,
            mode: payload.mode.unwrap_or(RunMode::Integrated),
            pipeline: payload.pipeline.unwrap_or_default(),
            catalog: None,
            dcat_input: None,
            connection_ids: payload.connection_ids.clone(),
            script: Some(payload.script),
        };
        state.db.insert_job(&job).await;
        return (StatusCode::CREATED, Json(job)).into_response();
    }

    let dcat_enabled = payload.dcat_enabled.unwrap_or(false);

    let resolved = match rewrite::resolve(&payload.script, &state.db).await {
        Ok(r) => r,
        Err(err) => return error_response(StatusCode::BAD_REQUEST, "REWRITE_ERROR", err),
    };

    let job = Job {
        id: id.clone(),
        status: JobStatus::Pending,
        name: payload.name.or_else(|| Some(id[..8].to_string())),
        created_at: now_iso8601(),
        started_at: None,
        completed_at: None,
        error: None,
        mode: payload.mode.unwrap_or(RunMode::Integrated),
        pipeline: payload.pipeline.unwrap_or_default(),
        catalog: None,
        dcat_input: None,
        connection_ids: payload.connection_ids.clone(),
        script: None,
    };

    state.db.insert_job(&job).await;

    let org_settings = if dcat_enabled {
        state.db.get_org_settings().await
    } else {
        None
    };

    state.runner.spawn(
        id,
        resolved.script,
        resolved.storage,
        org_settings,
        dcat_enabled,
        payload.dcat_format,
    );

    (StatusCode::ACCEPTED, Json(job)).into_response()
}

pub async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.db.get_job(&id).await {
        Some(job) => (StatusCode::OK, Json(job)).into_response(),
        None => not_found(&id),
    }
}

pub async fn update_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateJobRequest>,
) -> Response {
    match state.db.update_job(&id, |job| {
        if job.status != JobStatus::Draft {
            return;
        }
        if let Some(script) = payload.script {
            job.script = Some(script);
        }
        if let Some(name) = payload.name {
            job.name = Some(name);
        }
    }).await {
        Some(job) if job.status == JobStatus::Draft => (StatusCode::OK, Json(job)).into_response(),
        Some(_) => error_response(StatusCode::BAD_REQUEST, "NOT_DRAFT", "Only draft jobs can be updated"),
        None => not_found(&id),
    }
}

pub async fn cancel_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.db.update_job(&id, |job| {
        job.status = JobStatus::Cancelled;
        job.completed_at = Some(now_iso8601());
    }).await {
        Some(job) => (StatusCode::OK, Json(job)).into_response(),
        None => not_found(&id),
    }
}

pub async fn delete_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    if state.db.get_job(&id).await.is_none() {
        return not_found(&id);
    }

    let graph_name = format!("urn:keasy:job:{id}");
    state.catalog.clear_named_graph(&graph_name);

    {
        let mut cache = state.output_cache.lock().await;
        cache.remove(&id);
    }

    state.db.remove_job(&id).await;

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
    if state.db.get_job(&id).await.is_none() {
        return not_found(&id);
    }

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

    let graph_name = format!("urn:keasy:job:{id}");
    match state.catalog.serialize_graph(Some(&graph_name), format) {
        Ok(catalog) if !catalog.trim().is_empty() => {
            (StatusCode::OK, Json(serde_json::json!({ "catalog": catalog }))).into_response()
        }
        Ok(_) => error_response(StatusCode::NOT_FOUND, "no_catalog", "No DCAT catalog available for this job"),
        Err(err) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "serialization_error", err),
    }
}

pub async fn get_job_graph(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.db.get_job(&id).await {
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

pub async fn get_dashboard_layout(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    if state.db.get_job(&id).await.is_none() {
        return not_found(&id);
    }
    match state.db.get_dashboard_layout(&id).await {
        Some(layout) => (StatusCode::OK, Json(layout)).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

pub async fn save_dashboard_layout(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    if state.db.get_job(&id).await.is_none() {
        return not_found(&id);
    }
    state.db.set_dashboard_layout(&id, &body).await;
    StatusCode::OK.into_response()
}

fn not_found(id: &str) -> Response {
    error_response(
        StatusCode::NOT_FOUND,
        "not_found",
        format!("Job '{}' not found", id),
    )
}
