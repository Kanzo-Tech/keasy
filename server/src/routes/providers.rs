use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::error::data_response;
use crate::jobs::fossil_runner::{FossilRunner, ProviderInfo};

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
