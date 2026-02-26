use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rudof_rdf::rdf_core::RDFFormat;

use crate::cloud::reader;
use crate::settings::types::LocationType;
use crate::tenant::TenantScoped;
use crate::validation::types::{ShapeFormat, ValidationRequest};
use crate::validation::ValidatableGraph;
use crate::AppState;

use super::error_response;

/// Phase 1 placeholder — Phase 4 middleware replaces this with real session context.
fn placeholder_ctx() -> crate::tenant::TenantContext {
    TenantScoped::placeholder()
}

/// Phase 1 placeholder scoped around a value — Phase 4 middleware replaces this.
fn placeholder_scoped<T: Clone>(inner: T) -> TenantScoped<T> {
    TenantScoped::placeholder_with(inner)
}

pub async fn validate_job(
    State(state): State<AppState>,
    Json(req): Json<ValidationRequest>,
) -> Response {
    let connection = match state.db.get_connection(&placeholder_scoped(req.connection_id.as_str())).await {
        Some(s) => s,
        None => {
            return error_response(
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "Connection not found",
            )
        }
    };

    if connection.location_type == LocationType::Local {
        return error_response(
            StatusCode::BAD_REQUEST,
            "UNSUPPORTED",
            "Validation from local connections is not yet supported",
        );
    }

    let account_id = match &connection.cloud_account_id {
        Some(id) => id.clone(),
        None => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "NO_ACCOUNT",
                "Connection has no cloud account",
            )
        }
    };

    let creds = state.db.env_snapshot(&placeholder_ctx(), std::slice::from_ref(&account_id)).await;

    let data_bytes = match reader::download(&req.data_url, &creds).await {
        Ok(bytes) => bytes,
        Err(msg) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                "CLOUD_ERROR",
                format!("Failed to download output data: {msg}"),
            )
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

    let data_format = rdf_format_from_url(&req.data_url);

    let result = tokio::task::spawn_blocking(move || {
        let graph = ValidatableGraph::from_bytes(&data_bytes, &data_format)?;
        match shape_format {
            ShapeFormat::ShEx => graph.validate_shex(&shape_content),
            ShapeFormat::Shacl => graph.validate_shacl(&shape_content),
        }
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
