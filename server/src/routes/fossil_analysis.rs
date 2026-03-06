use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use fossil_lsp::{CompletionItem, DiagnosticItem};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::jobs::rewrite;
use crate::jobs::script;
use crate::middleware::tenant::RequireParticipant;

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AnalyzeRequest {
    pub script: String,
    pub cursor_offset: usize,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct AnalyzeResponse {
    pub completions: Vec<CompletionItem>,
    pub diagnostics: Vec<DiagnosticItem>,
}

#[utoipa::path(post, path = "/v1/fossil/analyze", tag = "Fossil",
    request_body = AnalyzeRequest,
    responses((status = 200, description = "Analysis result", body = AnalyzeResponse))
)]
pub async fn analyze(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(payload): Json<AnalyzeRequest>,
) -> impl IntoResponse {
    let cursor_offset = payload.cursor_offset;

    let resolved = match rewrite::resolve(&payload.script, &ctx.org_id.0, &state.db).await {
        Ok(r) => r,
        Err(err) => {
            return (
                StatusCode::OK,
                Json(AnalyzeResponse {
                    completions: vec![],
                    diagnostics: vec![DiagnosticItem {
                        from: err.from,
                        to: err.to,
                        severity: "error",
                        message: err.message,
                    }],
                }),
            );
        }
    };

    let org_id = ctx.org_id.0.clone();
    let hosts = state.analysis_hosts.clone();

    let result = tokio::task::spawn_blocking(move || {
        let source = resolved.script;
        let gcx = script::init_context(resolved.storage);

        // Take the host out of the LRU so we don't hold the mutex during compilation.
        let mut host = {
            let mut guard = hosts.lock().unwrap_or_else(|e| e.into_inner());
            guard.pop(&org_id).unwrap_or_default()
        };

        let analysis = host.analyze(&source, gcx);
        let completions = host.completions(&source, cursor_offset);

        // Put it back.
        {
            let mut guard = hosts.lock().unwrap_or_else(|e| e.into_inner());
            guard.put(org_id, host);
        }

        AnalyzeResponse {
            completions,
            diagnostics: analysis.diagnostics,
        }
    })
    .await;

    match result {
        Ok(response) => (StatusCode::OK, Json(response)),
        Err(err) => (
            StatusCode::OK,
            Json(AnalyzeResponse {
                completions: vec![],
                diagnostics: vec![DiagnosticItem {
                    from: 0,
                    to: 0,
                    severity: "error",
                    message: format!("Internal error: {err}"),
                }],
            }),
        ),
    }
}
