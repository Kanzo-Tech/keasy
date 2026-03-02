use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rudof_rdf::rdf_core::RDFFormat;
use shex_ast::ShExFormat;

use crate::cloud::reader;
use crate::connections::models::LocationType;
use crate::error::{data_response, error_body};
use crate::middleware::tenant::RequireParticipant;
use super::validation_types::{ShapeFormat, ValidationRequest};
use super::validation::ValidatableGraph;
use crate::AppState;

/// Supported ShEx formats for detection (ShExR/RDF is niche — defer).
const SUPPORTED_SHEX_FORMATS: &[ShExFormat] = &[ShExFormat::ShExC, ShExFormat::ShExJ];

fn detect_shape_format(path: &str) -> Option<ShapeFormat> {
    let ext = path.rsplit('.').next()?.to_lowercase();
    for fmt in SUPPORTED_SHEX_FORMATS {
        if fmt.extensions().contains(&ext.as_str()) {
            return Some(ShapeFormat::ShEx(fmt.clone()));
        }
    }
    if ext == "ttl" {
        return Some(ShapeFormat::Shacl);
    }
    None
}

#[utoipa::path(post, path = "/v1/validate", tag = "Validation",
    responses((status = 200, description = "Validation result"), (status = 400, description = "Invalid request"))
)]
pub async fn validate_job(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(req): Json<ValidationRequest>,
) -> Response {
    let connection = match state.db.get_connection(&ctx.scoped(req.connection_id.as_str())).await {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "Connection not found")),
            ).into_response()
        }
    };

    if connection.location_type == LocationType::Local {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("unsupported", "Validation from local connections is not yet supported")),
        ).into_response();
    }

    let account_id = match &connection.cloud_account_id {
        Some(id) => id.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_body("no_account", "Connection has no cloud account")),
            ).into_response()
        }
    };

    let creds = state.db.env_snapshot(&ctx.as_ctx(), std::slice::from_ref(&account_id)).await;

    let data_bytes = match reader::download(&req.data_url, &creds).await {
        Ok(bytes) => bytes,
        Err(msg) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(error_body("cloud_error", format!("Failed to download output data: {msg}"))),
            ).into_response()
        }
    };

    let shape_url = format!(
        "{}/{}",
        connection.url.trim_end_matches('/'),
        req.shape_path.trim_start_matches('/')
    );
    let shape_bytes = match reader::download(&shape_url, &creds).await {
        Ok(bytes) => bytes,
        Err(msg) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(error_body("cloud_error", format!("Failed to download shape file: {msg}"))),
            ).into_response()
        }
    };

    let shape_content = match String::from_utf8(shape_bytes) {
        Ok(s) => s,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_body("invalid_file", "Shape file is not valid UTF-8")),
            ).into_response()
        }
    };

    let shape_format = match detect_shape_format(&req.shape_path) {
        Some(fmt) => fmt,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_body("unsupported_format", "Unsupported shape file extension. Use .shex/.shexj for ShEx or .ttl for SHACL.")),
            ).into_response();
        }
    };

    let data_format = rdf_format_from_url(&req.data_url);

    let result = tokio::task::spawn_blocking(move || {
        let graph = ValidatableGraph::from_bytes(&data_bytes, &data_format)?;
        match shape_format {
            ShapeFormat::ShEx(fmt) => graph.validate_shex(&shape_content, &fmt),
            ShapeFormat::Shacl => graph.validate_shacl(&shape_content),
        }
    })
    .await;

    match result {
        Ok(Ok(validation_result)) => data_response(validation_result).into_response(),
        Ok(Err(msg)) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(error_body("validation_error", msg)),
        ).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(error_body("internal_error", format!("Validation task panicked: {e}"))),
        ).into_response(),
    }
}

fn rdf_format_from_url(url: &str) -> RDFFormat {
    let path = url.split('?').next().unwrap_or(url);
    match path.rsplit('.').next() {
        Some("nt") | Some("ntriples") => RDFFormat::NTriples,
        Some("ttl") | Some("turtle") => RDFFormat::Turtle,
        Some("rdf") | Some("xml") => RDFFormat::Rdfxml,
        Some("nq") | Some("nquads") => RDFFormat::NQuads,
        Some("trig") => RDFFormat::TriG,
        Some("n3") => RDFFormat::N3,
        _ => RDFFormat::Turtle,
    }
}
