//! A graph's saved dashboard: read and replaced whole by the member who owns
//! the graph.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::{Editor, Reader};
use crate::domain::Dashboard;
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::graphs::{any, changeable, dashboards};
use crate::startup::AppState;

/// The most a saved dashboard may weigh, as stored JSON. A layout and its
/// encodings, not data.
pub const MAX_SPEC_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PutDashboardRequest {
    /// The dashboard, as the web serialises it: any JSON object.
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    pub spec: serde_json::Value,
}

#[utoipa::path(get, path = "/v1/graphs/{id}/dashboard", tag = "Graphs", security(("bearer" = ["reader"])),
    params(("id" = String, Path, description = "Graph ID")),
    responses(
        (status = 200, description = "The graph's saved dashboard, or null when none is saved", body = Option<Dashboard>),
        (status = 404, description = "Graph not found", body = ErrorBody),
    )
)]
pub async fn get_dashboard(
    _: Reader,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Option<Dashboard>>, Refusal> {
    any(&*state.db.read().await, &id)?;
    Ok(Json(dashboards::get(&*state.db.read().await, &id)?))
}

#[utoipa::path(put, path = "/v1/graphs/{id}/dashboard", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    request_body = PutDashboardRequest,
    responses(
        (status = 200, description = "Dashboard saved", body = Dashboard),
        (status = 400, description = "The spec is not a JSON object", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 413, description = "The spec is larger than a dashboard may be", body = ErrorBody),
    )
)]
/// The dashboard is the graph's: who may change the graph may save it.
pub async fn put_dashboard(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PutDashboardRequest>,
) -> Result<Json<Dashboard>, Refusal> {
    changeable(&*state.db.read().await, &caller, &id)?;
    let serde_json::Value::Object(spec) = payload.spec else {
        return Err(Refusal::invalid("A dashboard spec is a JSON object"));
    };
    let size = serde_json::to_vec(&spec)
        .map(|v| v.len())
        .unwrap_or(usize::MAX);
    if size > MAX_SPEC_BYTES {
        return Err(Refusal::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::RequestTooLarge,
            format!("A dashboard spec is at most {MAX_SPEC_BYTES} bytes; this one is {size}"),
        ));
    }
    Ok(Json(dashboards::put(
        &*state.db.write().await,
        &id,
        spec,
        &caller.actor(),
    )?))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_dashboard, put_dashboard))
}
