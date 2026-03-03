use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::{AppError, data_response, error_body};
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
    responses((status = 200, description = "Graph search results", body = Vec<crate::discovery::graph_types::SearchResult>))
)]
pub async fn search_nodes(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let limit = req.limit.unwrap_or(50).min(200);
    let query = req.query.unwrap_or_default();

    if let Some(job_id) = &req.job_id {
        let graph_name = match require_output_ready(&state, &ctx, job_id).await {
            Ok(g) => g,
            Err(r) => return Ok(r),
        };
        Ok(data_response(state.graph_store.search_nodes(Some(&graph_name), &query, limit)).into_response())
    } else {
        Ok(data_response(state.graph_store.search_nodes(None, &query, limit)).into_response())
    }
}

#[utoipa::path(post, path = "/v1/graph/expand", tag = "Graph",
    request_body = ExpandRequest,
    responses((status = 200, description = "Expanded node data", body = crate::discovery::convert::GraphData))
)]
pub async fn expand_node(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(req): Json<ExpandRequest>,
) -> Result<impl IntoResponse, AppError> {
    if let Some(job_id) = &req.job_id {
        let graph_name = match require_output_ready(&state, &ctx, job_id).await {
            Ok(g) => g,
            Err(r) => return Ok(r),
        };
        Ok(data_response(state.graph_store.expand_node(Some(&graph_name), &req.node_id)).into_response())
    } else {
        Ok(data_response(state.graph_store.expand_node(None, &req.node_id)).into_response())
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct QueryRequest {
    pub sparql: String,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/query", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = QueryRequest,
    responses(
        (status = 200, description = "SPARQL query results", body = crate::discovery::graph_types::TabularData),
        (status = 400, description = "SPARQL error"),
    )
)]
pub async fn query_discover(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<QueryRequest>,
) -> Response {
    let graph_name = match require_output_ready(&state, &ctx, &id).await {
        Ok(g) => g,
        Err(r) => return r,
    };
    match state.graph_store.sparql_select(&req.sparql, Some(&graph_name)) {
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
    responses((status = 200, description = "Chart data", body = crate::discovery::graph_types::TabularData))
)]
pub async fn chart_discover(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ChartRequest>,
) -> Response {
    let graph_name = match require_output_ready(&state, &ctx, &id).await {
        Ok(g) => g,
        Err(r) => return r,
    };
    let sparql = build_chart_sparql(&req);
    match state.graph_store.sparql_select(&sparql, Some(&graph_name)) {
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
    let graph_name = match require_output_ready(&state, &ctx, &id).await {
        Ok(g) => g,
        Err(r) => return r,
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

    match state.graph_store.serialize_graph(Some(&graph_name), format) {
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

#[derive(Serialize, utoipa::ToSchema)]
pub struct LoadDiscoverResponse {
    pub loaded: bool,
    pub triple_count: usize,
    pub subject_count: usize,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/load", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Discovery data status", body = LoadDiscoverResponse),
        (status = 202, description = "Job output not yet available"),
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

    let graph_name = format!("urn:keasy:output:{id}");
    let triple_count = state.graph_store.triple_count(Some(&graph_name));
    let loaded = triple_count > 0;

    data_response(LoadDiscoverResponse {
        loaded,
        triple_count,
        subject_count: state.graph_store.subject_count(),
    }).into_response()
}

/// Returns Ok(graph_name) if the output is ready to query, or Err(Response) with the right error.
/// Fast path: graph already has triples → no DB lookup needed.
/// Slow path: graph empty → check job status to distinguish "not completed" from "completed but no outputs".
pub(crate) async fn require_output_ready(state: &AppState, ctx: &TenantContext, job_id: &str) -> Result<String, Response> {
    let graph_name = format!("urn:keasy:output:{job_id}");
    if state.graph_store.graph_exists(&graph_name) {
        return Ok(graph_name);
    }
    match state.db.get_job(&ctx.scoped(job_id)).await {
        None => Err((StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response()),
        Some(j) if j.status != JobStatus::Completed => Err((
            StatusCode::BAD_REQUEST,
            Json(error_body("not_completed", "Job is not completed yet")),
        ).into_response()),
        Some(_) => Ok(graph_name), // completed but no outputs — queries will return empty results
    }
}
