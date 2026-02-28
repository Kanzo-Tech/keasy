use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;

use crate::AppState;
use crate::error::data_response;
use crate::discovery::rdf_format::RdfExportFormat;
use crate::jobs::models::{CreateJobRequest, Job, JobStatus, RunMode, UpdateJobRequest, now_iso8601};
use super::rewrite;
use crate::middleware::tenant::RequireParticipant;

use super::errors::JobApiError;

pub async fn list_jobs(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, JobApiError> {
    let jobs = state.db.list_jobs(&ctx.as_ctx()).await;
    Ok(data_response(jobs))
}

pub async fn create_job(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
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
        state.db.insert_job(&ctx.as_ctx(), &job).await;
        return Ok((StatusCode::CREATED, data_response(job)).into_response());
    }

    let dcat_enabled = payload.dcat_enabled.unwrap_or(false);

    let resolved = rewrite::resolve(&payload.script, &ctx.org_id.0, &state.db).await
        .map_err(JobApiError::RewriteFailed)?;

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

    state.db.insert_job(&ctx.as_ctx(), &job).await;

    let org_settings = if dcat_enabled {
        state.db.get_org_settings().await
    } else {
        None
    };

    use crate::jobs::runner::SpawnParams;
    state.runner.spawn(SpawnParams {
        org_id: ctx.org_id.0.clone(),
        job_id: id,
        script: resolved.script,
        storage: resolved.storage,
        org_settings,
        dcat_enabled,
        dcat_format: payload.dcat_format,
    });

    Ok((StatusCode::ACCEPTED, data_response(job)).into_response())
}

pub async fn get_job(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.get_job(&ctx.scoped(id.as_str())).await {
        Some(job) => Ok(data_response(job).into_response()),
        None => Err(JobApiError::NotFound),
    }
}

pub async fn update_job(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<UpdateJobRequest>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.update_job(&ctx.scoped(id.as_str()), |job| {
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
        Some(job) if job.status == JobStatus::Draft => Ok(data_response(job).into_response()),
        Some(_) => Err(JobApiError::NotDraft),
        None => Err(JobApiError::NotFound),
    }
}

pub async fn cancel_job(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.update_job(&ctx.scoped(id.as_str()), |job| {
        job.status = JobStatus::Cancelled;
        job.completed_at = Some(now_iso8601());
    }).await {
        Some(job) => Ok(data_response(job).into_response()),
        None => Err(JobApiError::NotFound),
    }
}

pub async fn delete_job(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(&ctx.scoped(id.as_str())).await.is_none() {
        return Err(JobApiError::NotFound);
    }

    let graph_name = format!("urn:keasy:job:{id}");
    state.catalog.clear_named_graph(&graph_name);

    {
        let mut cache = state.output_cache.lock().await;
        cache.remove(&id);
    }

    state.db.remove_job(&ctx.scoped(id.as_str())).await;

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
pub struct CatalogQuery {
    pub format: Option<String>,
}

pub async fn get_job_catalog(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<CatalogQuery>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(&ctx.scoped(id.as_str())).await.is_none() {
        return Err(JobApiError::NotFound);
    }

    let format = query
        .format
        .as_deref()
        .map(RdfExportFormat::from_name)
        .transpose()
        .map_err(JobApiError::InvalidFormat)?
        .unwrap_or(RdfExportFormat::Turtle);

    let graph_name = format!("urn:keasy:job:{id}");
    match state.catalog.serialize_graph(Some(&graph_name), format) {
        Ok(catalog) if !catalog.trim().is_empty() => {
            Ok(data_response(serde_json::json!({ "catalog": catalog })).into_response())
        }
        Ok(_) => Err(JobApiError::NoCatalog),
        Err(err) => Err(JobApiError::Serialization(err)),
    }
}

pub async fn get_job_graph(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.get_job(&ctx.scoped(id.as_str())).await {
        Some(_) => {
            let graph_name = format!("urn:keasy:job:{id}");
            let graph_data = state.catalog.get_graph(Some(&graph_name));
            Ok(data_response(graph_data).into_response())
        }
        None => Err(JobApiError::NotFound),
    }
}

#[derive(Deserialize)]
pub struct UnifiedGraphQuery {
    pub org_id: Option<String>,
}

pub async fn get_unified_graph(
    RequireParticipant(_ctx): RequireParticipant,
    State(state): State<AppState>,
    Query(query): Query<UnifiedGraphQuery>,
) -> impl IntoResponse {
    let graph_data = match query.org_id {
        Some(org_id) => {
            let job_ids = state.db.completed_job_ids_for_org(&org_id).await;
            let graph_names: Vec<String> = job_ids
                .into_iter()
                .map(|id| format!("urn:keasy:job:{id}"))
                .collect();
            state.catalog.get_merged_graphs(&graph_names)
        }
        None => state.catalog.get_graph(None),
    };
    data_response(graph_data)
}

pub async fn get_dashboard_layout(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(&ctx.scoped(id.as_str())).await.is_none() {
        return Err(JobApiError::NotFound);
    }
    match state.db.get_dashboard_layout(&id).await {
        Some(layout) => Ok(data_response(layout).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

pub async fn save_dashboard_layout(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(&ctx.scoped(id.as_str())).await.is_none() {
        return Err(JobApiError::NotFound);
    }
    state.db.set_dashboard_layout(&id, &body).await;
    Ok(StatusCode::OK.into_response())
}
