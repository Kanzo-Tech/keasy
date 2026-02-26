use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::cloud_accounts::reader;
use crate::error::{AppError, data_response, error_body};
use super::loader;
use super::rdf_graph::RdfGraph;
use crate::jobs::models::JobStatus;
use super::rdf_format::RdfExportFormat;
use crate::tenant::{placeholder_ctx, placeholder_scoped};

#[derive(Deserialize)]
pub struct SearchRequest {
    pub query: Option<String>,
    pub limit: Option<usize>,
    pub job_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ExpandRequest {
    pub node_id: String,
    pub job_id: Option<String>,
}

pub async fn search_nodes(
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let limit = req.limit.unwrap_or(50).min(200);
    let query = req.query.unwrap_or_default();

    if let Some(job_id) = &req.job_id {
        let graph = get_cached_graph(&state, job_id).await;
        match graph {
            Some(g) => Ok(data_response(g.search_nodes(&query, limit)).into_response()),
            None => Err(AppError::BadRequest("not_loaded: Output data for this job is not loaded. Call /discover/load first.".to_string())),
        }
    } else {
        Ok(data_response(state.catalog.search_nodes(&query, limit)).into_response())
    }
}

pub async fn expand_node(
    State(state): State<AppState>,
    Json(req): Json<ExpandRequest>,
) -> Result<impl IntoResponse, AppError> {
    if let Some(job_id) = &req.job_id {
        let graph = get_cached_graph(&state, job_id).await;
        match graph {
            Some(g) => Ok(data_response(g.expand_node(&req.node_id)).into_response()),
            None => Err(AppError::BadRequest("not_loaded: Output data for this job is not loaded. Call /discover/load first.".to_string())),
        }
    } else {
        Ok(data_response(state.catalog.expand_node(&req.node_id)).into_response())
    }
}

#[derive(Serialize)]
pub struct LoadDiscoverResponse {
    pub loaded: bool,
    pub triple_count: usize,
    pub subject_count: usize,
}

#[derive(Deserialize)]
pub struct QueryRequest {
    pub sparql: String,
}

pub async fn query_discover(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<QueryRequest>,
) -> Response {
    let graph = match get_cached_graph(&state, &id).await {
        Some(g) => g,
        None => return not_loaded_error(),
    };
    match graph.sparql_select(&req.sparql) {
        Ok(data) => data_response(data).into_response(),
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(error_body("sparql_error", msg)),
        ).into_response(),
    }
}

#[derive(Deserialize)]
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

pub async fn chart_discover(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ChartRequest>,
) -> Response {
    let graph = match get_cached_graph(&state, &id).await {
        Some(g) => g,
        None => return not_loaded_error(),
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

pub async fn load_discover(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let job = match state.db.get_job(&placeholder_scoped(id.as_str())).await {
        Some(j) => j,
        None => return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response(),
    };

    if job.status != JobStatus::Completed {
        return (StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response();
    }

    if let Some(graph) = get_cached_graph(&state, &id).await {
        let count = graph.triple_count(None);
        if count > 0 {
            let subjects = graph.subject_count();
            return data_response(LoadDiscoverResponse { loaded: true, triple_count: count, subject_count: subjects }).into_response();
        }
    }

    let destinations: Vec<String> = job.pipeline.outputs.iter().filter_map(|o| o.destination.clone()).collect();

    if destinations.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(error_body("no_destinations", "Job has no output destinations"))).into_response();
    }

    let creds = state.db.env_snapshot_all(&placeholder_ctx()).await;
    let mut all_triples = Vec::new();

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

        let triples = match loader::parse_rdf_to_triples(&bytes, dest_url) {
            Ok(t) => t,
            Err(msg) => {
                return (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(error_body("parse_error", format!("Failed to parse {dest_url}: {msg}"))),
                ).into_response();
            }
        };

        all_triples.extend(triples);
    }

    let graph = RdfGraph::new();
    graph.insert_triples(None, &all_triples);
    let total = graph.triple_count(None);
    let subjects = graph.subject_count();

    {
        let mut cache = state.output_cache.lock().await;
        cache.insert(id, graph);
    }

    data_response(LoadDiscoverResponse { loaded: true, triple_count: total, subject_count: subjects }).into_response()
}

#[derive(Deserialize)]
pub struct ExportQuery {
    pub format: Option<String>,
}

pub async fn export_discover(
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<ExportQuery>,
) -> Response {
    let graph = match get_cached_graph(&state, &id).await {
        Some(g) => g,
        None => return not_loaded_error(),
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

async fn get_cached_graph(state: &AppState, job_id: &str) -> Option<Arc<RdfGraph>> {
    let mut cache = state.output_cache.lock().await;
    cache.get(job_id)
}

fn not_loaded_error() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(error_body("not_loaded", "Output data for this job is not loaded. Call /discover/load first.")),
    )
        .into_response()
}
