//! Fossil script analysis endpoint.
//!
//! Live diagnostics for the script editor — Salsa-based: each call builds
//! a fresh `FossilDb` (Storage is not Send+Sync), runs the compiler
//! pipeline, and reports accumulated `Diagnostic`s with byte spans.
//!
//! Completions are returned empty until fossil-lang exposes a
//! `completions_at(file, offset)` query — placeholder kept in the API
//! shape so the frontend can wire up a single endpoint for both.

use axum::{Json, extract::State, response::IntoResponse};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::error::{AppError, data_response};
use crate::middleware::tenant::{IsParticipant, Require};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AnalyzeRequest {
    pub script: String,
    /// Reserved for future completion support (LSP-style cursor position).
    #[serde(default)]
    pub cursor_offset: usize,
}

/// Completion item returned by the analysis endpoint.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct CompletionItem {
    pub label: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Diagnostic item returned by the analysis endpoint.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct DiagnosticItem {
    pub from: usize,
    pub to: usize,
    pub severity: String,
    pub message: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct AnalyzeResponse {
    pub completions: Vec<CompletionItem>,
    pub diagnostics: Vec<DiagnosticItem>,
}

#[utoipa::path(post, path = "/v1/fossil/analyze", tag = "Fossil",
    request_body = AnalyzeRequest,
    responses(
        (status = 200, description = "Analysis result", body = AnalyzeResponse),
    )
)]
pub async fn analyze(
    _ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(payload): Json<AnalyzeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let registry = state.fossil_registry.clone();

    // Salsa Storage is not Send+Sync — run on the blocking pool. Editor
    // analyze calls are debounced upstream; cost of a fresh db per call
    // is acceptable for the current usage pattern.
    let response = tokio::task::spawn_blocking(move || -> AnalyzeResponse {
        use fossil_lang::db::SourceFile;

        let db = crate::executor::fossil::build_fossil_db(&registry);
        let file = SourceFile::new(&db, payload.script, "<analyze>".into());

        // Driving rq() runs parse → lower → infer → rq, accumulating
        // diagnostics from every phase along the way.
        let _ = fossil_lang::queries::rq(&db, file);
        let raw = fossil_lang::queries::rq::accumulated::<fossil_lang::db::Diagnostic>(
            &db, file,
        );

        let diagnostics: Vec<DiagnosticItem> = raw
            .into_iter()
            .map(|d| DiagnosticItem {
                from: d.offset,
                to: d.offset.saturating_add(d.len),
                severity: severity_label(d.severity).to_string(),
                message: d.message.clone(),
            })
            .collect();

        AnalyzeResponse {
            completions: Vec::new(),
            diagnostics,
        }
    })
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("analyze panic: {e}")))?;

    Ok(data_response(response))
}

fn severity_label(s: fossil_lang::db::Severity) -> &'static str {
    match s {
        fossil_lang::db::Severity::Error => "error",
        fossil_lang::db::Severity::Warning => "warning",
    }
}
