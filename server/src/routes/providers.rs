use axum::response::IntoResponse;
use serde::Serialize;

use fossil_lang::runtime::storage::StorageConfig;

use crate::error::data_response;
use crate::jobs::script::init_context;

#[derive(Serialize, utoipa::ToSchema)]
pub struct ProviderEntry {
    name: String,
    extensions: Vec<&'static str>,
    #[schema(value_type = String)]
    kind: fossil_lang::traits::provider::ProviderKind,
}

#[utoipa::path(get, path = "/v1/providers", tag = "Providers",
    responses((status = 200, description = "List of available data providers", body = Vec<ProviderEntry>))
)]
pub async fn list_providers() -> impl IntoResponse {
    let gcx = init_context(StorageConfig::default());
    let providers: Vec<ProviderEntry> = gcx
        .list_providers()
        .into_iter()
        .map(|(name, info)| ProviderEntry {
            name,
            extensions: info.extensions.to_vec(),
            kind: info.kind,
        })
        .collect();
    data_response(providers)
}
