use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rudof_rdf::rdf_core::RDFFormat;
use shex_ast::ShExFormat;

use crate::cloud::reader;
use crate::connections::models::LocationType;
use crate::error::{data_response, error_body};
use crate::graph::format::RdfExportFormat;
use crate::jobs::models::JobStatus;
use crate::middleware::tenant::{IsParticipant, Require};
use super::types::{ShapeValidationResult, ValidationRequest};
use super::logic::ValidatableGraph;
use crate::AppState;

/// Supported ShEx formats for detection.
const SUPPORTED_SHEX_FORMATS: &[ShExFormat] = &[ShExFormat::ShExC, ShExFormat::ShExJ];

fn detect_shex_format(path: &str) -> Option<ShExFormat> {
    let ext = path.rsplit('.').next()?.to_lowercase();
    for fmt in SUPPORTED_SHEX_FORMATS {
        if fmt.extensions().contains(&ext.as_str()) {
            return Some(fmt.clone());
        }
    }
    None
}

#[utoipa::path(post, path = "/v1/validate", tag = "Validation",
    request_body = ValidationRequest,
    responses(
        (status = 200, description = "Validation result", body = ShapeValidationResult),
        (status = 400, description = "Invalid request"),
    )
)]
pub async fn validate_job(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(req): Json<ValidationRequest>,
) -> Response {
    // Look up the job and load its fragment dataset
    let job = match state.db.get_job(&ctx.scoped(req.job_id.as_str())).await {
        Some(j) => j,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(error_body("not_found", "Job not found")),
            ).into_response()
        }
    };

    if job.status != JobStatus::Completed {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("not_completed", "Job is not completed yet")),
        ).into_response();
    }

    let fragment_base = match &job.fragment_base {
        Some(u) => u.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_body("no_fragments", "Job has no fragment output to validate")),
            ).into_response()
        }
    };

    // Load the connection for the shape file
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

    // Download shape file from the vocab connection
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

    let shex_format = match detect_shex_format(&req.shape_path) {
        Some(fmt) => fmt,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_body("unsupported_format", "Unsupported shape file extension. Use .shex for ShExC or .shexj for ShExJ.")),
            ).into_response();
        }
    };

    // Load fragment dataset and serialize to N-Triples for validation
    let job_creds = state
        .db
        .build_storage_config(&ctx.scoped(()), &ctx.org_id.0, &job.connection_ids)
        .await;

    let dataset = match state
        .fragment_resolver
        .resolve_dataset(&fragment_base, &job_creds)
        .await
    {
        Ok(ds) => ds,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("fragment_error", e)),
            ).into_response()
        }
    };

    let nt_bytes = match dataset.serialize(RdfExportFormat::NTriples) {
        Ok(b) => b.into_bytes(),
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(error_body("serialization_error", e)),
            ).into_response()
        }
    };

    let result = tokio::task::spawn_blocking(move || {
        let graph = ValidatableGraph::from_bytes(&nt_bytes, &RDFFormat::NTriples)?;
        graph.validate_shex(&shape_content, &shex_format)
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
