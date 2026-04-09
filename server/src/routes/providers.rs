use axum::response::IntoResponse;
use serde::Serialize;

use crate::error::data_response;

#[derive(Serialize, utoipa::ToSchema)]
pub struct ProviderEntry {
    name: String,
    extensions: Vec<&'static str>,
    kind: String,
}

#[utoipa::path(get, path = "/v1/providers", tag = "Providers",
    responses((status = 200, description = "List of available data providers", body = Vec<ProviderEntry>))
)]
pub async fn list_providers() -> impl IntoResponse {
    // TODO: Providers are now registered as builtins in fossil_lang::builtins.
    // Extract the list from the Registry instead of GlobalContext.
    let registry = fossil_lang::queries::registry();
    let providers: Vec<ProviderEntry> = registry
        .functions
        .iter()
        .filter(|f| f.namespace.is_empty() && matches!(f.impl_, fossil_lang::registry::OpImpl::SourceSql(_) | fossil_lang::registry::OpImpl::Preprocess { .. }))
        .map(|f| ProviderEntry {
            name: f.name.to_string(),
            extensions: vec![], // TODO: extensions not tracked in Registry
            kind: "data".to_string(),
        })
        .collect();
    data_response(providers)
}
