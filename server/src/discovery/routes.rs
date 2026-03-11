use std::collections::{BTreeMap, HashSet};

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

// ── Field Stats (generic graph statistics endpoint) ──────────────────────

#[derive(Serialize, utoipa::ToSchema)]
pub struct FieldTopValue {
    pub value: String,
    pub count: usize,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct FieldStats {
    pub predicate: String,
    pub short_name: String,
    pub count: usize,
    pub distinct: usize,
    pub is_numeric: bool,
    pub is_object_property: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub avg: Option<f64>,
    pub top_values: Option<Vec<FieldTopValue>>,
}

#[utoipa::path(get, path = "/v1/jobs/{id}/discover/field-stats", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "Field statistics from graph profile", body = Vec<FieldStats>),
        (status = 400, description = "Job not ready"),
    )
)]
pub async fn field_stats(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let graph_name = match require_output_ready(&state, &ctx, &id).await {
        Ok(g) => g,
        Err(r) => return r,
    };
    let profile = state.graph_store.get_profile(&graph_name);
    let stats: Vec<FieldStats> = profile
        .predicates
        .iter()
        .map(|p| {
            let is_numeric = p.min.is_some();
            FieldStats {
                predicate: p.predicate.clone(),
                short_name: p.short_name.clone(),
                count: p.count,
                distinct: p.distinct,
                is_numeric,
                is_object_property: p.is_object_property,
                min: p.min,
                max: p.max,
                avg: p.avg,
                top_values: p.top_values.as_ref().map(|tvs| {
                    tvs.iter()
                        .map(|(v, c)| FieldTopValue {
                            value: v.clone(),
                            count: *c,
                        })
                        .collect()
                }),
            }
        })
        .collect();
    data_response(stats).into_response()
}

// ── Graph Search & Expand ────────────────────────────────────────────────

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

#[derive(Deserialize, Serialize, Clone, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Aggregation {
    Count,
    Sum,
    Avg,
    None,
}

impl Default for Aggregation {
    fn default() -> Self { Self::Count }
}

/// A reference to a field, including the traversal path from the anchor subject.
#[derive(Deserialize, utoipa::ToSchema)]
pub struct FieldRef {
    /// Predicate IRI of the target field
    pub predicate: String,
    /// Object property IRIs to traverse from the root subject (empty = direct field)
    #[serde(default)]
    pub path: Vec<String>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ChartRequest {
    /// X-axis field reference
    pub x: FieldRef,
    /// Y-axis field reference (optional — omit for count-only)
    pub y: Option<FieldRef>,
    /// Group-by / split-by field reference
    pub group: Option<FieldRef>,
    #[serde(default)]
    pub aggregation: Aggregation,
    /// Limit x-axis categories to top N (rest collapsed into "Other")
    pub top_n: Option<usize>,
    /// Limit split-by categories to top N (rest collapsed into "Other")
    pub group_top_n: Option<usize>,
    /// RDF type IRI to scope the query to a single entity type
    pub rdf_type: Option<String>,
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
        Ok(data) => {
            let data = apply_top_n(data, req.top_n, req.group_top_n);
            data_response(data).into_response()
        }
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(error_body("sparql_error", msg)),
        ).into_response(),
    }
}

/// Generate SPARQL triple patterns that traverse `field.path` hops then bind the target predicate
/// to `?{var}`. For a direct field (empty path), emits `?s <pred> ?var .`
/// For a 1-hop path `[hopIri]`, emits `?s <hopIri> ?_var_0 . ?_var_0 <pred> ?var .`
fn field_pattern(field: &FieldRef, var: &str) -> String {
    if field.path.is_empty() {
        return format!("?s <{}> ?{var} .", field.predicate);
    }
    let mut patterns = Vec::new();
    let mut prev = "s".to_string();
    for (i, hop) in field.path.iter().enumerate() {
        let next = format!("_{var}_{i}");
        patterns.push(format!("?{prev} <{hop}> ?{next}"));
        prev = next;
    }
    patterns.push(format!("?{prev} <{}> ?{var}", field.predicate));
    patterns.join(" . ") + " ."
}

fn build_chart_sparql(req: &ChartRequest) -> String {
    let x_pat = field_pattern(&req.x, "x");
    let type_filter = req.rdf_type.as_ref()
        .map(|t| format!("?s a <{t}> . "))
        .unwrap_or_default();

    match (&req.y, &req.group) {
        (_, Some(group)) => {
            let agg = match req.aggregation {
                Aggregation::Sum => "(SUM(?y) AS ?value)",
                Aggregation::Avg => "(AVG(?y) AS ?value)",
                _ => "(COUNT(*) AS ?value)",
            };
            let y_pattern = req.y.as_ref()
                .map(|y| format!(" {}", field_pattern(y, "y")))
                .unwrap_or_default();
            let group_pat = field_pattern(group, "group");
            format!(
                "SELECT ?x ?group {agg} WHERE {{ {type_filter}{x_pat}{y_pattern} {group_pat} }} GROUP BY ?x ?group ORDER BY ?x"
            )
        }
        (Some(y), None) if matches!(req.aggregation, Aggregation::None) => {
            let y_pat = field_pattern(y, "y");
            format!("SELECT ?x ?y WHERE {{ {type_filter}{x_pat} {y_pat} }} ORDER BY ?x")
        }
        (Some(y), None) => {
            let agg = match req.aggregation {
                Aggregation::Sum => "(SUM(?y) AS ?value)".to_string(),
                Aggregation::Avg => "(AVG(?y) AS ?value)".to_string(),
                _ => "(COUNT(*) AS ?value)".to_string(),
            };
            let y_pat = field_pattern(y, "y");
            format!(
                "SELECT ?x {agg} WHERE {{ {type_filter}{x_pat} {y_pat} }} GROUP BY ?x ORDER BY ?x"
            )
        }
        (None, None) => {
            format!(
                "SELECT ?x (COUNT(*) AS ?value) WHERE {{ {type_filter}{x_pat} }} GROUP BY ?x ORDER BY DESC(?value)"
            )
        }
    }
}

/// Collapse low-frequency x-axis and/or group categories into an "Other" bucket.
/// Operates on the already-computed `TabularData` rows in Rust (post-processing).
fn apply_top_n(
    mut data: super::graph_types::TabularData,
    top_n: Option<usize>,
    group_top_n: Option<usize>,
) -> super::graph_types::TabularData {
    use serde_json::Value;

    fn str_val(row: &BTreeMap<String, Value>, key: &str) -> String {
        row.get(key)
            .and_then(|v| match v {
                Value::String(s) => Some(s.clone()),
                other => Some(other.to_string()),
            })
            .unwrap_or_default()
    }

    fn num_val(row: &BTreeMap<String, Value>) -> f64 {
        row.get("value")
            .and_then(|v| match v {
                Value::Number(n) => n.as_f64(),
                Value::String(s) => s.parse().ok(),
                _ => None,
            })
            .unwrap_or(0.0)
    }

    fn grouped_row(x: String, g: String, v: f64) -> BTreeMap<String, Value> {
        let mut row = BTreeMap::new();
        row.insert("x".to_string(), Value::String(x));
        row.insert("group".to_string(), Value::String(g));
        row.insert("value".to_string(), serde_json::json!(v));
        row
    }

    fn top_keys(totals: BTreeMap<String, f64>, n: usize) -> HashSet<String> {
        let mut sorted: Vec<_> = totals.into_iter().collect();
        sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        sorted.into_iter().take(n).map(|(k, _)| k).collect()
    }

    let has_group = data.columns.contains(&"group".to_string());

    // Apply x-axis top_n
    if let Some(n) = top_n {
        if data.rows.len() > n && data.columns.contains(&"x".to_string()) {
            if has_group {
                let mut x_totals: BTreeMap<String, f64> = BTreeMap::new();
                for row in &data.rows {
                    *x_totals.entry(str_val(row, "x")).or_default() += num_val(row);
                }
                let top_x = top_keys(x_totals, n);

                let mut merged: BTreeMap<(String, String), f64> = BTreeMap::new();
                for row in &data.rows {
                    let x = str_val(row, "x");
                    let display_x = if top_x.contains(&x) { x } else { "Other".to_string() };
                    *merged.entry((display_x, str_val(row, "group"))).or_default() += num_val(row);
                }
                data.rows = merged.into_iter().map(|((x, g), v)| grouped_row(x, g, v)).collect();
            } else {
                let rest = data.rows.split_off(n);
                let other_sum: f64 = rest.iter().map(|r| num_val(r)).sum();
                if other_sum > 0.0 {
                    let mut other_row = BTreeMap::new();
                    other_row.insert("x".to_string(), Value::String("Other".to_string()));
                    other_row.insert("value".to_string(), serde_json::json!(other_sum));
                    data.rows.push(other_row);
                }
            }
        }
    }

    // Apply group top_n
    if let Some(n) = group_top_n {
        if has_group {
            let mut group_totals: BTreeMap<String, f64> = BTreeMap::new();
            for row in &data.rows {
                *group_totals.entry(str_val(row, "group")).or_default() += num_val(row);
            }
            if group_totals.len() > n {
                let top_g = top_keys(group_totals, n);

                let mut merged: BTreeMap<(String, String), f64> = BTreeMap::new();
                for row in &data.rows {
                    let group = str_val(row, "group");
                    let display_g = if top_g.contains(&group) { group } else { "Other".to_string() };
                    *merged.entry((str_val(row, "x"), display_g)).or_default() += num_val(row);
                }
                data.rows = merged.into_iter().map(|((x, g), v)| grouped_row(x, g, v)).collect();
            }
        }
    }

    data
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
