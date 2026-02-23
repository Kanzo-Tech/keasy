use axum::Json;
use axum::response::IntoResponse;
use serde::Serialize;

use fossil_lang::runtime::storage::StorageConfig;

use crate::script::init_context;

#[derive(Serialize)]
struct ProviderEntry {
    name: String,
    extensions: Vec<&'static str>,
    kind: fossil_lang::traits::provider::ProviderKind,
}

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
    Json(providers)
}
