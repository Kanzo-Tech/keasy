use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::cloud::reader;
use crate::error::{AppError, data_response, error_body};
use super::rdf_graph::RdfGraph;
use crate::jobs::models::JobStatus;
use super::rdf_format::RdfExportFormat;
use crate::middleware::tenant::{RequireParticipant, TenantContext};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SearchRequest {
    pub query: Option<String>,
    pub limit: Option<usize>,
    pub job_id: Option<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ExpandRequest {
    pub node_id: String,
    pub job_id: Option<String>,
}

#[utoipa::path(post, path = "/v1/graph/search", tag = "Graph",
    request_body = SearchRequest,
    responses((status = 200, description = "Graph search results"))
)]
pub async fn search_nodes(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let limit = req.limit.unwrap_or(50).min(200);
    let query = req.query.unwrap_or_default();

    if let Some(job_id) = &req.job_id {
        match load_graph_for_job(&state, &ctx, job_id).await {
            Ok(g) => Ok(data_response(g.search_nodes(&query, limit)).into_response()),
            Err(resp) => Ok(resp),
        }
    } else {
        Ok(data_response(state.catalog.search_nodes(&query, limit)).into_response())
    }
}

#[utoipa::path(post, path = "/v1/graph/expand", tag = "Graph",
    request_body = ExpandRequest,
    responses((status = 200, description = "Expanded node data"))
)]
pub async fn expand_node(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(req): Json<ExpandRequest>,
) -> Result<impl IntoResponse, AppError> {
    if let Some(job_id) = &req.job_id {
        match load_graph_for_job(&state, &ctx, job_id).await {
            Ok(g) => Ok(data_response(g.expand_node(&req.node_id)).into_response()),
            Err(resp) => Ok(resp),
        }
    } else {
        Ok(data_response(state.catalog.expand_node(&req.node_id)).into_response())
    }
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct LoadDiscoverResponse {
    pub loaded: bool,
    pub triple_count: usize,
    pub subject_count: usize,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct QueryRequest {
    pub sparql: String,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/query", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = QueryRequest,
    responses((status = 200, description = "SPARQL query results"), (status = 400, description = "SPARQL error"))
)]
pub async fn query_discover(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<QueryRequest>,
) -> Response {
    let graph = match load_graph_for_job(&state, &ctx, &id).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    match graph.sparql_select(&req.sparql) {
        Ok(data) => data_response(data).into_response(),
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(error_body("sparql_error", msg)),
        ).into_response(),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ChartRequest {
    pub x_predicate: String,
    pub y_predicate: Option<String>,
    pub group_predicate: Option<String>,
    #[serde(default = "default_aggregation")]
    pub aggregation: String,
}

fn default_aggregation() -> String {
    "count".to_string()
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/chart", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = ChartRequest,
    responses((status = 200, description = "Chart data"))
)]
pub async fn chart_discover(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ChartRequest>,
) -> Response {
    let graph = match load_graph_for_job(&state, &ctx, &id).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let sparql = build_chart_sparql(&req);
    match graph.sparql_select(&sparql) {
        Ok(data) => data_response(data).into_response(),
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(error_body("sparql_error", msg)),
        ).into_response(),
    }
}

fn build_chart_sparql(req: &ChartRequest) -> String {
    let x = &req.x_predicate;

    match (&req.y_predicate, &req.group_predicate) {
        (_, Some(group)) => {
            let agg = match req.aggregation.as_str() {
                "sum" => "(SUM(?y) AS ?value)",
                "avg" => "(AVG(?y) AS ?value)",
                _ => "(COUNT(*) AS ?value)",
            };
            let y_pattern = req.y_predicate.as_ref()
                .map(|y| format!("?s <{y}> ?y ."))
                .unwrap_or_default();
            format!(
                "SELECT ?x ?group {agg} WHERE {{ ?s <{x}> ?x . {y_pattern} ?s <{group}> ?group }} GROUP BY ?x ?group ORDER BY ?x"
            )
        }
        (Some(y), None) if req.aggregation == "none" => {
            format!("SELECT ?x ?y WHERE {{ ?s <{x}> ?x . ?s <{y}> ?y }} ORDER BY ?x")
        }
        (Some(y), None) => {
            let agg = match req.aggregation.as_str() {
                "sum" => "(SUM(?y) AS ?value)".to_string(),
                "avg" => "(AVG(?y) AS ?value)".to_string(),
                _ => "(COUNT(*) AS ?value)".to_string(),
            };
            format!(
                "SELECT ?x {agg} WHERE {{ ?s <{x}> ?x . ?s <{y}> ?y }} GROUP BY ?x ORDER BY ?x"
            )
        }
        (None, None) => {
            format!(
                "SELECT ?x (COUNT(*) AS ?value) WHERE {{ ?s <{x}> ?x }} GROUP BY ?x ORDER BY DESC(?value)"
            )
        }
    }
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/load", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Discovery data loaded", body = LoadDiscoverResponse),
        (status = 400, description = "Job not completed"),
    )
)]
pub async fn load_discover(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let job = match state.db.get_job(&ctx.scoped(id.as_str())).await {
        Some(j) => j,
        None => return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response(),
    };

    if job.status != JobStatus::Completed {
        return (StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response();
    }

    let destinations: Vec<String> = job.pipeline.outputs.iter().filter_map(|o| o.destination.clone()).collect();

    if destinations.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(error_body("no_destinations", "Job has no output destinations"))).into_response();
    }

    let creds = state.db.env_snapshot_all(&ctx.as_ctx()).await;
    let graph = RdfGraph::new();

    for dest_url in &destinations {
        let bytes = match reader::download(dest_url, &creds).await {
            Ok(b) => b,
            Err(msg) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(error_body("cloud_error", format!("Failed to download {dest_url}: {msg}"))),
                ).into_response();
            }
        };

        if let Err(msg) = graph.bulk_load_bytes(None, &bytes, dest_url) {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(error_body("parse_error", format!("Failed to parse {dest_url}: {msg}"))),
            ).into_response();
        }
    }
    let total = graph.triple_count(None);
    let subjects = graph.subject_count();

    data_response(LoadDiscoverResponse { loaded: true, triple_count: total, subject_count: subjects }).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ExportQuery {
    pub format: Option<String>,
}

#[utoipa::path(get, path = "/v1/jobs/{id}/discover/export", tag = "Discovery",
    params(
        ("id" = String, Path, description = "Job ID"),
        ("format" = Option<String>, Query, description = "Export format (turtle, ntriples, rdfxml, etc.)"),
    ),
    responses((status = 200, description = "RDF file download"))
)]
pub async fn export_discover(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<ExportQuery>,
) -> Response {
    let graph = match load_graph_for_job(&state, &ctx, &id).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };

    let format = match query
        .format
        .as_deref()
        .map(RdfExportFormat::from_name)
        .transpose()
    {
        Ok(f) => f.unwrap_or(RdfExportFormat::Turtle),
        Err(err) => return (StatusCode::BAD_REQUEST, Json(error_body("invalid_format", err))).into_response(),
    };

    match graph.serialize_to_format(format) {
        Ok(body) => {
            let filename = format!("discover-{}.{}", &id[..8.min(id.len())], format.extension());
            (
                StatusCode::OK,
                [
                    ("Content-Type", format.content_type().to_string()),
                    ("Content-Disposition", format!("attachment; filename=\"{filename}\"")),
                ],
                body,
            )
                .into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("serialization_error", err))).into_response(),
    }
}

pub(crate) async fn load_graph_for_job(state: &AppState, ctx: &TenantContext, job_id: &str) -> Result<RdfGraph, Response> {
    let job = match state.db.get_job(&ctx.scoped(job_id)).await {
        Some(j) if j.status == JobStatus::Completed => j,
        Some(_) => return Err(not_loaded_error()),
        None => return Err((StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response()),
    };
    let destinations: Vec<String> = job.pipeline.outputs.iter().filter_map(|o| o.destination.clone()).collect();
    let creds = state.db.env_snapshot_all(&ctx.as_ctx()).await;
    let graph = RdfGraph::new();
    for dest_url in &destinations {
        let bytes = reader::download(dest_url, &creds).await
            .map_err(|msg| (StatusCode::BAD_GATEWAY, Json(error_body("cloud_error", format!("Failed to download {dest_url}: {msg}")))).into_response())?;
        graph.bulk_load_bytes(None, &bytes, dest_url)
            .map_err(|msg| (StatusCode::UNPROCESSABLE_ENTITY, Json(error_body("parse_error", format!("Failed to parse {dest_url}: {msg}")))).into_response())?;
    }
    Ok(graph)
}

fn not_loaded_error() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(error_body("not_loaded", "Output data for this job is not loaded. Call /discover/load first.")),
    )
        .into_response()
}
