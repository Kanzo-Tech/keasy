use axum::extract::State;
use axum::response::IntoResponse;
use serde::Serialize;

use crate::error::data_response;
use crate::AppState;

#[derive(Serialize, utoipa::ToSchema)]
pub struct ProviderEntry {
    name: String,
    extensions: Vec<&'static str>,
    kind: String,
}

#[utoipa::path(get, path = "/v1/providers", tag = "Providers",
    responses((status = 200, description = "List of available data providers", body = Vec<ProviderEntry>))
)]
pub async fn list_providers(State(state): State<AppState>) -> impl IntoResponse {
    let providers: Vec<ProviderEntry> = state
        .fossil_registry
        .sources
        .iter()
        .map(|src| {
            let extensions = match src.name.as_str() {
                "csv" => vec!["csv"],
                "excel" => vec!["xlsx", "xls"],
                "parquet" => vec!["parquet"],
                "json" | "json_lines" => vec!["json", "jsonl"],
                "pdf" => vec!["pdf"],
                "docx" => vec!["docx"],
                _ => vec![],
            };
            ProviderEntry {
                name: src.name.clone(),
                extensions,
                kind: "data".to_string(),
            }
        })
        .collect();
    data_response(providers)
}
