//! A graph's rules — one SHACL shapes graph, Turtle — read and replaced whole
//! by the member who owns the graph.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::{Editor, Reader};
use crate::domain::Rules;
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::graphs::{any, changeable, rules};
use crate::startup::AppState;

/// The most a saved shapes graph may weigh, in UTF-8 bytes of Turtle: the
/// dashboard's cap. Hand-written constraints, a few hundred shapes at most,
/// not data.
pub const MAX_SHAPES_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PutRulesRequest {
    /// The shapes graph, `text/turtle`, stored as sent. keasy does not parse
    /// it: rudof does, where the rules run.
    pub shapes: String,
}

#[utoipa::path(get, path = "/v1/graphs/{id}/rules", tag = "Graphs", security(("bearer" = ["reader"])),
    params(("id" = String, Path, description = "Graph ID")),
    responses(
        (status = 200, description = "The graph's rules, or null when none are saved", body = Option<Rules>),
        (status = 404, description = "Graph not found", body = ErrorBody),
    )
)]
pub async fn get_rules(
    _: Reader,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Option<Rules>>, Refusal> {
    any(&*state.db.read().await, &id)?;
    Ok(Json(rules::get(&*state.db.read().await, &id)?))
}

#[utoipa::path(put, path = "/v1/graphs/{id}/rules", tag = "Graphs", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Graph ID")),
    request_body = PutRulesRequest,
    responses(
        (status = 200, description = "Rules saved", body = Rules),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 413, description = "The shapes graph is larger than a graph's rules may be", body = ErrorBody),
    )
)]
/// The rules are the graph's: who may change the graph may save them.
pub async fn put_rules(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PutRulesRequest>,
) -> Result<Json<Rules>, Refusal> {
    changeable(&*state.db.read().await, &caller, &id)?;
    let size = payload.shapes.len();
    if size > MAX_SHAPES_BYTES {
        return Err(Refusal::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::RequestTooLarge,
            format!("A graph's rules are at most {MAX_SHAPES_BYTES} bytes; these are {size}"),
        ));
    }
    Ok(Json(rules::put(
        &*state.db.write().await,
        &id,
        &payload.shapes,
        &caller.actor(),
    )?))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_rules, put_rules))
}
