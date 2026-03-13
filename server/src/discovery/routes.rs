use std::collections::{BTreeMap, HashSet};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::{AppError, data_response, error_body};
use crate::graph::dataset::Dataset;
use crate::graph::format::RdfExportFormat;
use crate::graph::fragment::FragmentDataset;
use crate::jobs::models::JobStatus;
use crate::middleware::tenant::{AnyRole, IsParticipant, Require, TenantContext, TenantRole};

// ── Shared helper: load a FragmentDataset for a completed job ────────────

async fn resolve_dataset(
    state: &AppState,
    ctx: &TenantContext,
    job_id: &str,
) -> Result<FragmentDataset, Response> {
    let job = state
        .db
        .get_job(&ctx.scoped(job_id))
        .await
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "Job not found")),
            )
                .into_response()
        })?;

    if job.status != JobStatus::Completed {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(error_body("not_completed", "Job is not completed yet")),
        )
            .into_response());
    }

    let base_url = match &job.rdf_base {
        Some(u) => u.clone(),
        None => {
            // Completed but no fragments — return empty dataset
            return Ok(FragmentDataset::empty());
        }
    };

    let creds = state
        .db
        .build_storage_config(&ctx.scoped(()), &ctx.org_id.0, &job.connection_ids)
        .await;

    state
        .fragment_resolver
        .resolve_dataset(&base_url, &creds)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("fragment_error", e)),
            )
                .into_response()
        })
}

/// Role-based dataset resolution (IDS-RAM 4.0):
/// - Promotor (Broker): accesses DCAT catalogs — Oxigraph first, SQLite fallback.
/// - Participant: accesses outputs via fragment dataset.
async fn resolve_role_dataset(
    state: &AppState,
    ctx: &TenantContext,
    job_id: &str,
) -> Result<FragmentDataset, Response> {
    match ctx.role {
        TenantRole::Promotor => {
            state.catalog_store.get_dataset(job_id).await
                .ok_or_else(|| {
                    (
                        StatusCode::NOT_FOUND,
                        Json(error_body("not_found", "Catalog not found")),
                    )
                        .into_response()
                })
        }
        _ => resolve_dataset(state, ctx, job_id).await,
    }
}

/// Checks that output is ready and returns Ok(()) or appropriate error.
/// Used by routes that need to confirm readiness but load their own dataset.
pub(crate) async fn require_output_ready(
    state: &AppState,
    ctx: &TenantContext,
    job_id: &str,
) -> Result<(), Response> {
    let job = state
        .db
        .get_job(&ctx.scoped(job_id))
        .await
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "Job not found")),
            )
                .into_response()
        })?;

    if job.status != JobStatus::Completed {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(error_body("not_completed", "Job is not completed yet")),
        )
            .into_response());
    }

    Ok(())
}

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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let dataset = match resolve_dataset(&state, &ctx, &id).await {
        Ok(ds) => ds,
        Err(r) => return r,
    };
    let profile = crate::ai::profiler::GraphProfile::build_from_dataset(&dataset, &id);
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
    responses((status = 200, description = "Graph search results", body = Vec<crate::graph::types::SearchResult>))
)]
pub async fn search_nodes(
    ctx: Require<AnyRole>,
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    let limit = req.limit.unwrap_or(50).min(200);
    let query = req.query.unwrap_or_default();

    let job_id = req.job_id.as_deref().unwrap_or("");
    if job_id.is_empty() {
        // No job specified — return empty results (no global graph store anymore)
        return Ok(data_response(Vec::<crate::graph::types::SearchResult>::new()).into_response());
    }

    let dataset = match resolve_role_dataset(&state, &ctx, job_id).await {
        Ok(ds) => ds,
        Err(r) => return Ok(r),
    };
    Ok(data_response(crate::graph::dataset::search_nodes(&dataset, &query, limit)).into_response())
}

#[utoipa::path(post, path = "/v1/graph/expand", tag = "Graph",
    request_body = ExpandRequest,
    responses((status = 200, description = "Expanded node data", body = crate::graph::convert::GraphData))
)]
pub async fn expand_node(
    ctx: Require<AnyRole>,
    State(state): State<AppState>,
    Json(req): Json<ExpandRequest>,
) -> Result<impl IntoResponse, AppError> {
    let job_id = req.job_id.as_deref().unwrap_or("");
    if job_id.is_empty() {
        return Ok(data_response(crate::graph::convert::GraphData {
            nodes: vec![],
            links: vec![],
        }).into_response());
    }

    let dataset = match resolve_role_dataset(&state, &ctx, job_id).await {
        Ok(ds) => ds,
        Err(r) => return Ok(r),
    };
    Ok(data_response(crate::graph::dataset::expand_node(&dataset, &req.node_id)).into_response())
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct QueryRequest {
    pub sparql: String,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/query", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = QueryRequest,
    responses(
        (status = 200, description = "SPARQL query results", body = crate::graph::types::TabularData),
        (status = 400, description = "SPARQL error"),
    )
)]
pub async fn query_discover(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<QueryRequest>,
) -> Response {
    if req.sparql.len() > 10_000 {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("sparql_error", "Query too large (max 10KB)")),
        ).into_response();
    }
    let dataset = match resolve_dataset(&state, &ctx, &id).await {
        Ok(ds) => ds,
        Err(r) => return r,
    };
    match dataset.sparql_select(&req.sparql) {
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
    responses((status = 200, description = "Chart data", body = crate::graph::types::TabularData))
)]
pub async fn chart_discover(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ChartRequest>,
) -> Response {
    let dataset = match resolve_dataset(&state, &ctx, &id).await {
        Ok(ds) => ds,
        Err(r) => return r,
    };
    let sparql = match build_chart_sparql(&req) {
        Ok(s) => s,
        Err(msg) => return (
            StatusCode::BAD_REQUEST,
            Json(error_body("invalid_iri", msg)),
        ).into_response(),
    };
    match dataset.sparql_select(&sparql) {
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

/// Validates that a string is safe to interpolate as an IRI in SPARQL.
/// Rejects characters that could break out of `<...>` delimiters.
fn validate_iri(iri: &str) -> Result<(), String> {
    if iri.is_empty() {
        return Err("IRI cannot be empty".into());
    }
    if iri.contains(|c: char| "<>\"{|}\\^` ".contains(c) || c.is_control()) {
        return Err(format!("Invalid IRI characters in: {}", iri));
    }
    Ok(())
}

/// Generate SPARQL triple patterns that traverse `field.path` hops then bind the target predicate
/// to `?{var}`. For a direct field (empty path), emits `?s <pred> ?var .`
/// For a 1-hop path `[hopIri]`, emits `?s <hopIri> ?_var_0 . ?_var_0 <pred> ?var .`
fn field_pattern(field: &FieldRef, var: &str) -> Result<String, String> {
    validate_iri(&field.predicate)?;
    for hop in &field.path {
        validate_iri(hop)?;
    }
    if field.path.is_empty() {
        return Ok(format!("?s <{}> ?{var} .", field.predicate));
    }
    let mut patterns = Vec::new();
    let mut prev = "s".to_string();
    for (i, hop) in field.path.iter().enumerate() {
        let next = format!("_{var}_{i}");
        patterns.push(format!("?{prev} <{hop}> ?{next}"));
        prev = next;
    }
    patterns.push(format!("?{prev} <{}> ?{var}", field.predicate));
    Ok(patterns.join(" . ") + " .")
}

fn build_chart_sparql(req: &ChartRequest) -> Result<String, String> {
    let x_pat = field_pattern(&req.x, "x")?;

    if let Some(ref t) = req.rdf_type {
        validate_iri(t)?;
    }
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
            let y_pattern = match req.y.as_ref() {
                Some(y) => format!(" {}", field_pattern(y, "y")?),
                None => String::new(),
            };
            let group_pat = field_pattern(group, "group")?;
            Ok(format!(
                "SELECT ?x ?group {agg} WHERE {{ {type_filter}{x_pat}{y_pattern} {group_pat} }} GROUP BY ?x ?group ORDER BY ?x"
            ))
        }
        (Some(y), None) if matches!(req.aggregation, Aggregation::None) => {
            let y_pat = field_pattern(y, "y")?;
            Ok(format!("SELECT ?x ?y WHERE {{ {type_filter}{x_pat} {y_pat} }} ORDER BY ?x"))
        }
        (Some(y), None) => {
            let agg = match req.aggregation {
                Aggregation::Sum => "(SUM(?y) AS ?value)".to_string(),
                Aggregation::Avg => "(AVG(?y) AS ?value)".to_string(),
                _ => "(COUNT(*) AS ?value)".to_string(),
            };
            let y_pat = field_pattern(y, "y")?;
            Ok(format!(
                "SELECT ?x {agg} WHERE {{ {type_filter}{x_pat} {y_pat} }} GROUP BY ?x ORDER BY ?x"
            ))
        }
        (None, None) => {
            Ok(format!(
                "SELECT ?x (COUNT(*) AS ?value) WHERE {{ {type_filter}{x_pat} }} GROUP BY ?x ORDER BY DESC(?value)"
            ))
        }
    }
}

/// Collapse low-frequency x-axis and/or group categories into an "Other" bucket.
/// Operates on the already-computed `TabularData` rows in Rust (post-processing).
fn apply_top_n(
    mut data: crate::graph::types::TabularData,
    top_n: Option<usize>,
    group_top_n: Option<usize>,
) -> crate::graph::types::TabularData {
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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<ExportQuery>,
) -> Response {
    let dataset = match resolve_dataset(&state, &ctx, &id).await {
        Ok(ds) => ds,
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

    let body = match dataset.serialize(format) {
        Ok(b) => b,
        Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("serialization_error", err))).into_response(),
    };
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
    ctx: Require<IsParticipant>,
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

    let loaded = job.rdf_base.is_some();
    let triple_count = if loaded { 1 } else { 0 }; // Actual count requires downloading; signal presence only

    data_response(LoadDiscoverResponse {
        loaded,
        triple_count,
    }).into_response()
}

// ── Triple Pattern Fragments (TPF) ─────────────────────────────────────

const TPF_PAGE_SIZE: usize = 100;

#[derive(Deserialize, utoipa::IntoParams)]
pub struct TpfQuery {
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub object: Option<String>,
    #[serde(default = "default_page")]
    pub page: usize,
}

fn default_page() -> usize { 1 }

#[derive(Serialize, utoipa::ToSchema)]
pub struct TpfResponse {
    pub triples: Vec<TpfTriple>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct TpfTriple {
    pub subject: String,
    pub predicate: String,
    pub object: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub datatype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

#[utoipa::path(get, path = "/v1/tpf/{id}", tag = "Discovery",
    params(
        ("id" = String, Path, description = "Job ID"),
        TpfQuery,
    ),
    responses(
        (status = 200, description = "Triple Pattern Fragment results", body = TpfResponse),
        (status = 404, description = "No fragments for this job"),
    )
)]
pub async fn tpf_query(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<TpfQuery>,
) -> Response {
    // Look up job and check it has fragments
    let job = match state.db.get_job(&ctx.scoped(id.as_str())).await {
        Some(j) => j,
        None => return (StatusCode::NOT_FOUND, Json(error_body("not_found", "Job not found"))).into_response(),
    };

    if job.status != JobStatus::Completed {
        return (StatusCode::BAD_REQUEST, Json(error_body("not_completed", "Job is not completed yet"))).into_response();
    }

    let base_url = match &job.rdf_base {
        Some(u) => u.clone(),
        None => return (StatusCode::NOT_FOUND, Json(error_body("no_fragments", "Job has no fragment output"))).into_response(),
    };

    // Get cloud credentials from the job's connections
    let creds = state.db.build_storage_config(&ctx.scoped(()), &ctx.org_id.0, &job.connection_ids).await;

    let dataset = match state.fragment_resolver.resolve_dataset(&base_url, &creds).await {
        Ok(ds) => ds,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(error_body("fragment_error", e))).into_response(),
    };

    // Pattern match and paginate
    let all: Vec<TpfTriple> = dataset
        .triples(
            query.subject.as_deref(),
            query.predicate.as_deref(),
            query.object.as_deref(),
        )
        .map(|t| TpfTriple {
            subject: t.subject,
            predicate: t.predicate,
            object: t.object,
            datatype: t.object_datatype,
            lang: t.object_lang,
        })
        .collect();

    let total = all.len();
    let page = query.page.max(1);
    let start = (page - 1) * TPF_PAGE_SIZE;
    let triples: Vec<TpfTriple> = all.into_iter().skip(start).take(TPF_PAGE_SIZE).collect();

    data_response(TpfResponse {
        triples,
        total,
        page,
        page_size: TPF_PAGE_SIZE,
    }).into_response()
}
