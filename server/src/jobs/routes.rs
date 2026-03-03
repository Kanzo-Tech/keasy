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

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct CatalogResponse {
    pub catalog: String,
}

#[utoipa::path(get, path = "/v1/jobs", tag = "Jobs",
    responses(
        (status = 200, description = "List of jobs", body = Vec<Job>),
    )
)]
pub async fn list_jobs(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, JobApiError> {
    let jobs = state.db.list_jobs(&ctx.as_ctx()).await;
    Ok(data_response(jobs))
}

#[utoipa::path(post, path = "/v1/jobs", tag = "Jobs",
    request_body = CreateJobRequest,
    responses(
        (status = 201, description = "Draft job created", body = Job),
        (status = 202, description = "Job submitted for execution", body = Job),
    )
)]
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
        state.db.insert_job(&ctx.as_ctx(), &job).await
            .map_err(JobApiError::Internal)?;
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

    state.db.insert_job(&ctx.as_ctx(), &job).await
        .map_err(JobApiError::Internal)?;

    let org_settings = if dcat_enabled {
        state.db.get_organization(&ctx.org_id.0).await.map(|org| {
            crate::settings::org::OrgSettings {
                publisher_name: org.legal_name,
                ..Default::default()
            }
        })
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

#[utoipa::path(get, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job details", body = Job),
        (status = 404, description = "Job not found"),
    )
)]
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

#[utoipa::path(put, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    request_body = UpdateJobRequest,
    responses(
        (status = 200, description = "Job updated", body = Job),
        (status = 400, description = "Job is not a draft"),
        (status = 404, description = "Job not found"),
    )
)]
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
    }).await.map_err(JobApiError::Internal)? {
        Some(job) if job.status == JobStatus::Draft => Ok(data_response(job).into_response()),
        Some(_) => Err(JobApiError::NotDraft),
        None => Err(JobApiError::NotFound),
    }
}

#[utoipa::path(post, path = "/v1/jobs/{id}/cancel", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job cancelled", body = Job),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn cancel_job(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.update_job(&ctx.scoped(id.as_str()), |job| {
        job.status = JobStatus::Cancelled;
        job.completed_at = Some(now_iso8601());
    }).await.map_err(JobApiError::Internal)? {
        Some(job) => Ok(data_response(job).into_response()),
        None => Err(JobApiError::NotFound),
    }
}

#[utoipa::path(delete, path = "/v1/jobs/{id}", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 204, description = "Job deleted"),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn delete_job(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    if state.db.get_job(&ctx.scoped(id.as_str())).await.is_none() {
        return Err(JobApiError::NotFound);
    }

    let cat_graph = format!("urn:keasy:job:{id}");
    let out_graph = format!("urn:keasy:output:{id}");
    state.graph_store.clear_named_graph(&cat_graph);
    state.graph_store.clear_named_graph(&out_graph);

    state.db.remove_job(&ctx.scoped(id.as_str())).await
        .map_err(JobApiError::Internal)?;

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
pub struct CatalogQuery {
    pub format: Option<String>,
}

#[utoipa::path(get, path = "/v1/jobs/{id}/catalog", tag = "Jobs",
    params(
        ("id" = String, Path, description = "Job ID"),
        ("format" = Option<String>, Query, description = "RDF export format"),
    ),
    responses(
        (status = 200, description = "DCAT catalog", body = CatalogResponse),
        (status = 404, description = "Job or catalog not found"),
    )
)]
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
    match state.graph_store.serialize_graph(Some(&graph_name), format) {
        Ok(catalog) if !catalog.trim().is_empty() => {
            Ok(data_response(CatalogResponse { catalog }).into_response())
        }
        Ok(_) => Err(JobApiError::NoCatalog),
        Err(err) => Err(JobApiError::Serialization(err)),
    }
}

#[utoipa::path(get, path = "/v1/jobs/{id}/graph", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Job knowledge graph", body = crate::discovery::convert::GraphData),
        (status = 404, description = "Job not found"),
    )
)]
pub async fn get_job_graph(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, JobApiError> {
    match state.db.get_job(&ctx.scoped(id.as_str())).await {
        Some(_) => {
            let graph_name = format!("urn:keasy:job:{id}");
            let graph_data = state.graph_store.get_graph(Some(&graph_name));
            Ok(data_response(graph_data).into_response())
        }
        None => Err(JobApiError::NotFound),
    }
}

#[derive(Deserialize)]
pub struct UnifiedGraphQuery {
    pub org_id: Option<String>,
}

#[utoipa::path(get, path = "/v1/graph", tag = "Jobs",
    params(("org_id" = Option<String>, Query, description = "Filter by organization")),
    responses((status = 200, description = "Unified knowledge graph", body = crate::discovery::convert::GraphData))
)]
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
            state.graph_store.get_merged_graphs(&graph_names)
        }
        None => state.graph_store.get_graph(None),
    };
    data_response(graph_data)
}

#[utoipa::path(get, path = "/v1/jobs/{id}/dashboard-layout", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "Dashboard layout"), (status = 204, description = "No layout saved"))
)]
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

#[utoipa::path(put, path = "/v1/jobs/{id}/dashboard-layout", tag = "Jobs",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "Layout saved"))
)]
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
