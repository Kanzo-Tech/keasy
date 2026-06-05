use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::error::data_response;
use crate::jobs::fossil_runner::{FossilRunner, ProviderInfo, SourceRefInfo};

#[utoipa::path(get, path = "/v1/providers", tag = "Providers",
    responses((status = 200, description = "List of available data providers", body = Vec<ProviderInfo>))
)]
pub async fn list_providers() -> impl IntoResponse {
    // Host boundary: fossil owns which sources it supports. We ask the `fossil`
    // CLI (`providers --output-json`) over the subprocess — the same way runs
    // and catalogs are executed — rather than linking the compiler in-process.
    match tokio::task::spawn_blocking(|| FossilRunner::from_env().run_providers()).await {
        Ok(Ok(providers)) => data_response(providers).into_response(),
        Ok(Err(e)) => {
            tracing::error!(error = %e, "failed to list providers via fossil subprocess");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to list providers").into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "provider listing task panicked");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to list providers").into_response()
        }
    }
}

/// Request body for `POST /v1/refs`: the `.fossil` script to parse.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct RefsRequest {
    /// The `.fossil` program text whose external references to enumerate.
    pub script: String,
}

#[utoipa::path(post, path = "/v1/refs", tag = "Providers",
    request_body = RefsRequest,
    responses((status = 200, description = "The program's typed external references", body = Vec<SourceRefInfo>))
)]
pub async fn list_refs(Json(req): Json<RefsRequest>) -> impl IntoResponse {
    // Host boundary: fossil parses the program and reports its references (the
    // typed lineage). keasy derives a job's connections from the distinct
    // `connection` aliases — never by regex-matching `@name/` in script text.
    match tokio::task::spawn_blocking(move || FossilRunner::from_env().run_refs(&req.script)).await {
        Ok(Ok(refs)) => data_response(refs).into_response(),
        Ok(Err(e)) => {
            tracing::error!(error = %e, "failed to list refs via fossil subprocess");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to parse references").into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "ref listing task panicked");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to parse references").into_response()
        }
    }
}
