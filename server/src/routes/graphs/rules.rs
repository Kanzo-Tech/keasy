//! A graph's rules — one SHACL shapes graph, a Turtle file — read, and
//! replaced whole with the file's name by the member who owns the graph.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use rudof_rdf::backend::{OxigraphInMemoryError, ReaderMode};
use rudof_rdf::{RDFFormat, STRING_BASE};
use serde::Deserialize;
use shacl::ir::{IRError, IRSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::permission::Action;
use crate::authentication::role::{Editor, Reader};
use crate::domain::Rules;
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::graphs::{any, permitted, rules};
use crate::startup::AppState;

/// The most a saved shapes graph may weigh, in UTF-8 bytes of Turtle: the
/// dashboard's cap. Hand-written constraints, a few hundred shapes at most,
/// not data.
pub const MAX_SHAPES_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct PutRulesRequest {
    /// The file's name, as the member dropped it: a name, not a path.
    pub name: String,
    /// The shapes graph, `text/turtle`, stored as sent once rudof reads it as
    /// a SHACL shapes graph.
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
        (status = 400, description = "`name` is not a file's name: `request/invalid` on the field `name`", body = ErrorBody),
        (status = 404, description = "Graph not found", body = ErrorBody),
        (status = 413, description = "The shapes graph is larger than a graph's rules may be", body = ErrorBody),
        (status = 422, description = "rudof refused the shapes graph: `rules/refused`, placed by `line` and `column` when it is not Turtle", body = ErrorBody),
    )
)]
/// The rules are the graph's: who may change the graph may save them.
pub async fn put_rules(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<PutRulesRequest>,
) -> Result<Json<Rules>, Refusal> {
    permitted(&*state.db.read().await, &caller, &id, Action::Manage)?;
    let size = payload.shapes.len();
    if size > MAX_SHAPES_BYTES {
        return Err(Refusal::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::RequestTooLarge,
            format!("A graph's rules are at most {MAX_SHAPES_BYTES} bytes; these are {size}"),
        ));
    }
    named(&payload.name)?;
    read(&payload.shapes)?;
    Ok(Json(rules::put(
        &*state.db.write().await,
        &id,
        &payload.name,
        &payload.shapes,
        &caller.actor(),
    )?))
}

/// The longest file name the common file systems keep, in bytes.
const MAX_NAME_BYTES: usize = 255;

/// Refuse a name no file could have: empty, longer than a file system keeps,
/// or holding a path separator or a control character. Download saves the
/// rules under it.
fn named(name: &str) -> Result<(), Refusal> {
    if name.is_empty()
        || name.len() > MAX_NAME_BYTES
        || name
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control())
    {
        return Err(Refusal::invalid_field(
            "name",
            format!("{name:?} is not a file's name"),
        ));
    }
    Ok(())
}

/// Refuse what rudof would: the shapes graph is read as the browser reads it
/// (Turtle, relative IRIs against rudof's base for a string) and compiled, so
/// a document every reader of the graph would fail on is never saved.
fn read(shapes: &str) -> Result<(), Refusal> {
    let Err(error) = IRSchema::from_str(
        shapes,
        &RDFFormat::Turtle,
        Some(STRING_BASE),
        &ReaderMode::Strict,
    ) else {
        return Ok(());
    };
    let at = match &error {
        IRError::OxigraphInMemoryError(e) => match &**e {
            OxigraphInMemoryError::Syntax { error, .. } => error.location().map(|at| at.start),
            _ => None,
        },
        _ => None,
    };
    let mut refusal = Refusal::field(
        StatusCode::UNPROCESSABLE_ENTITY,
        ErrorCode::RulesRefused,
        "shapes",
        error.to_string(),
    );
    if let Some(at) = at {
        refusal.body.data.line = Some(at.line + 1);
        refusal.body.data.column = Some(at.column + 1);
    }
    Err(refusal)
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_rules, put_rules))
}
