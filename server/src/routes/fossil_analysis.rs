use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use fossil_lsp::{CompletionItem, DiagnosticItem};
use serde::{Deserialize, Serialize};

use crate::{AppState, OrgAnalysisState, hash_str};
use crate::jobs::rewrite;
use crate::jobs::script;
use crate::middleware::tenant::{IsParticipant, Require};

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
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(payload): Json<AnalyzeRequest>,
) -> impl IntoResponse {
    let AnalyzeRequest { script, cursor_offset } = payload;
    let script_hash = hash_str(&script);
    let org_id = ctx.org_id.0.clone();

    // Check resolve cache: skip DB queries if the script hasn't changed.
    let cached = {
        let mut guard = state.org_analysis.lock().unwrap_or_else(|e| e.into_inner());
        guard.get(&org_id).and_then(|s| {
            s.resolved.as_ref().and_then(|(hash, resolved)| {
                if *hash == script_hash { Some(Arc::clone(resolved)) } else { None }
            })
        })
    };

    let resolved = if let Some(r) = cached {
        r
    } else {
        match rewrite::resolve(&script, &org_id, &state.db).await {
            Ok(r) => {
                let r = Arc::new(r);
                let mut guard = state.org_analysis.lock().unwrap_or_else(|e| e.into_inner());
                let entry = guard.get_or_insert_mut(org_id.clone(), || OrgAnalysisState {
                    host: Arc::new(std::sync::Mutex::new(fossil_lsp::AnalysisHost::default())),
                    resolved: None,
                });
                entry.resolved = Some((script_hash, Arc::clone(&r)));
                r
            }
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
        }
    };

    let org_analysis = state.org_analysis.clone();

    let result = tokio::task::spawn_blocking(move || {
        let gcx = script::init_context(resolved.storage.clone());

        // Get or create a per-org host behind its own mutex.
        let host_arc = {
            let mut guard = org_analysis.lock().unwrap_or_else(|e| e.into_inner());
            guard.get_or_insert_mut(org_id, || OrgAnalysisState {
                host: Arc::new(std::sync::Mutex::new(fossil_lsp::AnalysisHost::default())),
                resolved: None,
            }).host.clone()
        };

        let mut host = host_arc.lock().unwrap_or_else(|e| e.into_inner());
        let analysis = host.analyze(&resolved.script, gcx, Some(script_hash));
        // Use original script (pre-rewrite) for cursor context — the rewrite
        // changes string lengths (@conn → "url"), shifting character offsets.
        let completions = host.completions(&script, cursor_offset);

        tracing::debug!(
            cursor_offset,
            completions = completions.len(),
            first_kind = completions.first().map(|c| c.kind).unwrap_or("none"),
            diagnostics = analysis.diagnostics.len(),
            "fossil/analyze"
        );

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
