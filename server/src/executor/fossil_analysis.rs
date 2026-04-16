//! Fossil script analysis endpoint (completions + diagnostics).

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::middleware::tenant::{IsParticipant, Require};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AnalyzeRequest {
    pub script: String,
    pub cursor_offset: usize,
}

/// Completion item returned by the analysis endpoint.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct CompletionItem {
    pub label: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Diagnostic item returned by the analysis endpoint.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct DiagnosticItem {
    pub from: usize,
    pub to: usize,
    pub severity: &'static str,
    pub message: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct AnalyzeResponse {
    pub completions: Vec<CompletionItem>,
    pub diagnostics: Vec<DiagnosticItem>,
}

#[utoipa::path(post, path = "/v1/fossil/analyze", tag = "Fossil",
    request_body = AnalyzeRequest,
    responses((status = 501, description = "Not implemented"))
)]
pub async fn analyze(
    _ctx: Require<IsParticipant>,
    State(_state): State<AppState>,
    Json(payload): Json<AnalyzeRequest>,
) -> impl IntoResponse {
    // Salsa-based analysis (Phase 4) — not yet implemented
    let _ = payload;
    StatusCode::NOT_IMPLEMENTED
}
