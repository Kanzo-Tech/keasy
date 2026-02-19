use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::cloud::reader;
use crate::graph::loader;
use crate::graph::rdf_graph::RdfGraph;
use crate::validation::types::{ShapeFormat, ValidationRequest};
use crate::AppState;

use super::error_response;

pub async fn validate_job(
    State(state): State<AppState>,
    Json(req): Json<ValidationRequest>,
) -> Response {
    // Look up connection (for shapes)
    let conn = match state.connections.get(&req.connection_id) {
        Some(c) => c,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "Connection not found",
            )
        }
    };

    let creds = state.cloud_accounts.env_snapshot_all();

    // Download the actual output data from cloud
    let data_bytes = match reader::download_from_url(&req.data_url, &creds).await {
        Ok(bytes) => bytes,
        Err(msg) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                "CLOUD_ERROR",
                format!("Failed to download output data: {msg}"),
            )
        }
    };

    // Parse data as RDF triples
    let triples = match loader::parse_rdf_to_triples(&data_bytes, &req.data_url) {
        Ok(t) => t,
        Err(msg) => {
            return error_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "PARSE_ERROR",
                format!("Failed to parse output data: {msg}"),
            )
        }
    };

    // Download shape file from connection
    let shape_bytes =
        match reader::download_file(&conn.container_url, &req.shape_path, &creds).await {
            Ok(bytes) => bytes,
            Err(msg) => {
                return error_response(
                    StatusCode::BAD_GATEWAY,
                    "CLOUD_ERROR",
                    format!("Failed to download shape file: {msg}"),
                )
            }
        };

    let shape_content = match String::from_utf8(shape_bytes) {
        Ok(s) => s,
        Err(_) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "INVALID_FILE",
                "Shape file is not valid UTF-8",
            )
        }
    };

    // Detect shape format from file extension
    let path_lower = req.shape_path.to_lowercase();
    let shape_format = if path_lower.ends_with(".shex") {
        ShapeFormat::ShEx
    } else if path_lower.ends_with(".ttl") {
        ShapeFormat::Shacl
    } else {
        return error_response(
            StatusCode::BAD_REQUEST,
            "UNSUPPORTED_FORMAT",
            "Unsupported shape file extension. Use .shex for ShEx or .ttl for SHACL.",
        );
    };

    // Load data into a temporary RdfGraph, then validate
    let shape_map = req.shape_map.clone();
    let result = tokio::task::spawn_blocking(move || {
        let graph = RdfGraph::new();
        graph.insert_triples(None, &triples);
        graph.validate(&shape_content, shape_map.as_deref(), shape_format)
    })
    .await;

    match result {
        Ok(Ok(validation_result)) => Json(validation_result).into_response(),
        Ok(Err(msg)) => error_response(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            msg,
        ),
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            format!("Validation task panicked: {e}"),
        ),
    }
}
