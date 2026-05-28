//! JSON-RPC adapter for the Fossil editor's `HttpTransport` (per ADR-0036).
//!
//! `@fossil-lang/editor` (npm) wraps CodeMirror 6's `lsp-client`, which sends
//! standard LSP JSON-RPC envelopes over the configured `Transport`. The
//! `HttpTransport` POSTs each envelope as the request body of one fetch call
//! to a configurable endpoint — for Keasy, that endpoint is `/v1/fossil/lsp`.
//!
//! Wire shape (single envelope per HTTP request — NOT a batch):
//!
//! ```text
//! Request (call):     { "jsonrpc": "2.0", "id": 1, "method": "...",  "params": {...} }
//! Request (notify):   { "jsonrpc": "2.0",            "method": "...",  "params": {...} }
//!
//! Response (ok):      { "jsonrpc": "2.0", "id": 1, "result": {...} }
//! Response (err):     { "jsonrpc": "2.0", "id": 1, "error":  { "code": -32603, "message": "..." } }
//! Response (notify):  { "jsonrpc": "2.0", "method": "textDocument/publishDiagnostics", "params": {...} }
//! ```
//!
//! Per-doc text cache:
//!   `OrgAnalysisState.docs` (Arc<Mutex<HashMap<uri, text>>>) is the source of
//!   truth for the latest seen text. `didOpen`/`didChange` WRITE to it BEFORE
//!   calling `host.analyze`; `completion`/`hover` READ from it. If a client
//!   issues `completion` for a URI it never opened, we return `[]` gracefully
//!   (NOT `MethodNotFound`).
//!
//! Server-pushed diagnostics: the editor sends `didChange` as a NOTIFICATION
//! (no `id`). The HTTP transport is single-shot — each fetch yields ONE
//! response body — so we piggy-back diagnostics inside the response body to
//! `didChange` as a `textDocument/publishDiagnostics` notification envelope.
//! The CM6 `LSPClient` handles the de-correlation upstream (a notification
//! arriving on the response channel is dispatched to its handler set).
//!
//! Reuses the per-org `AnalysisHost` already plumbed by
//! `routes::fossil_analysis::analyze`. Legacy route stays for backwards-compat
//! (assistant wizard CQ-streaming, script validate path) until Phase 17.

use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use fossil_lsp::{AnalysisHost, CompletionItem as FCompletionItem, DiagnosticItem};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::jobs::script;
use crate::middleware::tenant::{IsParticipant, Require};
use crate::{AppState, OrgAnalysisState, hash_str};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    /// None = JSON-RPC notification; Some = request expecting a response.
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
    /// Server-pushed notification piggy-backed in a response body.
    /// Present only when the request was a notification that produced
    /// a server-side push (e.g., `didChange` → `publishDiagnostics`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

#[utoipa::path(post, path = "/v1/fossil/lsp", tag = "Fossil",
    request_body = JsonRpcRequest,
    responses((status = 200, description = "JSON-RPC response", body = JsonRpcResponse))
)]
pub async fn lsp(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(req): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    let org_id = ctx.org_id.0.clone();
    let req_id_for_err = req.id.clone();

    // Build the path resolver eagerly (same pattern as fossil_analysis.rs).
    // Resolver build failures surface as JSON-RPC errors with id preserved
    // so the client can match them to the failing call.
    let resolver = match state.db.build_path_resolver_for_org(&ctx.as_ctx()).await {
        Ok(r) => r,
        Err(err) => {
            return (
                StatusCode::OK,
                Json(error_response(req_id_for_err, -32000, &err)),
            );
        }
    };

    let org_analysis = state.org_analysis.clone();

    let result = tokio::task::spawn_blocking(move || {
        dispatch(req, org_id, org_analysis, resolver)
    })
    .await;

    match result {
        Ok(resp) => (StatusCode::OK, Json(resp)),
        Err(err) => (
            StatusCode::OK,
            Json(error_response(
                None,
                -32603,
                &format!("Internal error: {err}"),
            )),
        ),
    }
}

/// Per-method dispatch. Runs inside `spawn_blocking` — synchronous Rust.
fn dispatch(
    req: JsonRpcRequest,
    org_id: String,
    org_analysis: Arc<std::sync::Mutex<lru::LruCache<String, OrgAnalysisState>>>,
    resolver: Arc<dyn fossil_lang::traits::resolver::PathResolver>,
) -> JsonRpcResponse {
    // Get or create the per-org AnalysisHost + docs cache. Mirror the LRU
    // pattern from fossil_analysis.rs verbatim — same eviction semantics.
    let (host_arc, docs_arc) = {
        let mut guard = org_analysis.lock().unwrap_or_else(|e| e.into_inner());
        let entry = guard.get_or_insert_mut(org_id, || OrgAnalysisState {
            host: Arc::new(std::sync::Mutex::new(AnalysisHost::default())),
            docs: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        });
        (entry.host.clone(), entry.docs.clone())
    };

    match req.method.as_str() {
        // ── Handshake ────────────────────────────────────────────────
        "initialize" => respond(
            req.id,
            json!({
                "capabilities": {
                    // 1 = TextDocumentSyncKind.Full (we re-analyze whole doc per change).
                    "textDocumentSync": 1,
                    "completionProvider": { "triggerCharacters": [".", "@", "/"] },
                    "hoverProvider": true,
                    "diagnosticProvider": {
                        "interFileDependencies": false,
                        "workspaceDiagnostics": false
                    }
                },
                "serverInfo": { "name": "keasy-fossil-lsp", "version": "1.0.0" }
            }),
        ),
        "initialized" | "$/setTrace" | "$/cancelRequest" => respond(req.id, Value::Null),

        // ── Doc lifecycle: WRITE to per-doc text cache + re-analyze ──
        "textDocument/didOpen" => {
            let uri = extract_uri(&req.params).unwrap_or_default();
            let text = extract_didopen_text(&req.params).unwrap_or_default();
            // Cache write happens BEFORE host.analyze so any racing
            // completion/hover sees the latest text.
            {
                let mut docs = docs_arc.lock().unwrap_or_else(|e| e.into_inner());
                docs.insert(uri.clone(), text.clone());
            }
            run_analyze_and_push(req.id, host_arc, &resolver, &uri, &text)
        }
        "textDocument/didChange" => {
            let uri = extract_uri(&req.params).unwrap_or_default();
            // textDocumentSync=Full → contentChanges[0].text IS the full new doc.
            let text = extract_didchange_text(&req.params).unwrap_or_default();
            {
                let mut docs = docs_arc.lock().unwrap_or_else(|e| e.into_inner());
                docs.insert(uri.clone(), text.clone());
            }
            run_analyze_and_push(req.id, host_arc, &resolver, &uri, &text)
        }
        "textDocument/didClose" => {
            let uri = extract_uri(&req.params).unwrap_or_default();
            {
                let mut docs = docs_arc.lock().unwrap_or_else(|e| e.into_inner());
                docs.remove(&uri);
            }
            respond(req.id, Value::Null)
        }

        // ── Completion: READ cached text + call host.completions ─────
        "textDocument/completion" => {
            let uri = extract_uri(&req.params).unwrap_or_default();
            let pos = extract_position(&req.params).unwrap_or((0, 0));
            let cached_text = {
                let docs = docs_arc.lock().unwrap_or_else(|e| e.into_inner());
                docs.get(&uri).cloned().unwrap_or_default()
            };
            if cached_text.is_empty() {
                // Graceful empty list — happens when the client probes
                // completion before sending didOpen.
                return respond(req.id, json!([]));
            }
            let cursor_offset = cursor_offset_from(pos, &cached_text);
            let host_guard = host_arc.lock().unwrap_or_else(|e| e.into_inner());
            let completions = host_guard.completions(&cached_text, cursor_offset);
            drop(host_guard);
            respond(req.id, json!(lsp_completions_from(&completions)))
        }

        // ── Hover: graceful null (AnalysisHost has no hover API yet) ─
        "textDocument/hover" => respond(req.id, Value::Null),

        // ── MethodNotFound: graceful null so the editor degrades ─────
        _ => respond(req.id, Value::Null),
    }
}

/// Run analysis on `text` and, when the originating call was a NOTIFICATION
/// (no id), piggy-back a `textDocument/publishDiagnostics` notification in
/// the response body. When it WAS a call (has id), respond with `null` per
/// the LSP spec for didOpen/didChange (server MUST NOT return data for
/// these notifications, but our envelope tolerates either shape).
fn run_analyze_and_push(
    id: Option<Value>,
    host_arc: Arc<std::sync::Mutex<AnalysisHost>>,
    resolver: &Arc<dyn fossil_lang::traits::resolver::PathResolver>,
    uri: &str,
    text: &str,
) -> JsonRpcResponse {
    let script_hash = hash_str(text);
    let gcx = script::init_context(resolver.clone());
    let mut host = host_arc.lock().unwrap_or_else(|e| e.into_inner());
    let analysis = host.analyze(text, gcx, Some(script_hash));
    drop(host);

    if id.is_none() {
        // Notification → push diagnostics in the response body.
        JsonRpcResponse {
            jsonrpc: "2.0".into(),
            id: None,
            result: None,
            error: None,
            method: Some("textDocument/publishDiagnostics".into()),
            params: Some(json!({
                "uri": uri,
                "diagnostics": lsp_diagnostics_from(&analysis.diagnostics, text),
            })),
        }
    } else {
        // Call → null result; the client polls diagnostics separately if needed.
        respond(id, Value::Null)
    }
}

fn respond(id: Option<Value>, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: Some(result),
        error: None,
        method: None,
        params: None,
    }
}

fn error_response(id: Option<Value>, code: i32, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.to_string(),
        }),
        method: None,
        params: None,
    }
}

// ── Param extraction helpers ─────────────────────────────────────────

fn extract_uri(params: &Option<Value>) -> Option<String> {
    params
        .as_ref()?
        .get("textDocument")?
        .get("uri")?
        .as_str()
        .map(String::from)
}

/// `didOpen` params shape: `{ textDocument: { uri, languageId, version, text } }`.
fn extract_didopen_text(params: &Option<Value>) -> Option<String> {
    params
        .as_ref()?
        .get("textDocument")?
        .get("text")?
        .as_str()
        .map(String::from)
}

/// `didChange` params shape with TextDocumentSyncKind.Full:
/// `{ textDocument: { uri, version }, contentChanges: [{ text }] }`.
/// The first change entry's `text` is the full doc.
fn extract_didchange_text(params: &Option<Value>) -> Option<String> {
    params
        .as_ref()?
        .get("contentChanges")?
        .as_array()?
        .first()?
        .get("text")?
        .as_str()
        .map(String::from)
}

/// `(line, character)` (both 0-based, per LSP).
fn extract_position(params: &Option<Value>) -> Option<(usize, usize)> {
    let position = params.as_ref()?.get("position")?;
    let line = position.get("line")?.as_u64()? as usize;
    let character = position.get("character")?.as_u64()? as usize;
    Some((line, character))
}

/// Convert a (line, character) LSP position into a byte offset.
///
/// LSP `character` is conventionally UTF-16 code units, but Fossil source
/// files are ASCII-dominant and we treat `character` as char-count for now.
/// The fossil-lsp `AnalysisHost::completions` API takes a byte offset; we
/// walk the source to convert. Adequate for ASCII / BMP text; revisit if
/// non-BMP characters become common in Fossil scripts.
fn cursor_offset_from(pos: (usize, usize), text: &str) -> usize {
    let (target_line, target_char) = pos;
    let mut line = 0usize;
    let mut col = 0usize;
    for (byte_idx, ch) in text.char_indices() {
        if line == target_line && col == target_char {
            return byte_idx;
        }
        if ch == '\n' {
            line += 1;
            col = 0;
        } else {
            col += 1;
        }
    }
    text.len()
}

// ── Response mapping ─────────────────────────────────────────────────

/// Map fossil diagnostics (byte ranges) to LSP `Diagnostic[]` (line/col).
fn lsp_diagnostics_from(diags: &[DiagnosticItem], text: &str) -> Vec<Value> {
    diags
        .iter()
        .map(|d| {
            let (start_line, start_char) = byte_offset_to_lsp_pos(d.from, text);
            let (end_line, end_char) = byte_offset_to_lsp_pos(d.to, text);
            // LSP severity: 1 = Error, 2 = Warning, 3 = Info, 4 = Hint.
            let severity = if d.severity == "warning" { 2 } else { 1 };
            json!({
                "range": {
                    "start": { "line": start_line, "character": start_char },
                    "end":   { "line": end_line,   "character": end_char }
                },
                "severity": severity,
                "message": d.message,
                "source": "fossil"
            })
        })
        .collect()
}

/// Map fossil completions to LSP `CompletionItem[]`.
/// LSP CompletionItemKind: 5 = Field, 3 = Function, 6 = Variable, 7 = Class,
/// 9 = Module, 14 = Keyword, 22 = Struct (used for type/constructor).
fn lsp_completions_from(items: &[FCompletionItem]) -> Vec<Value> {
    items
        .iter()
        .map(|c| {
            let kind = match c.kind {
                "field" => 5,
                "function" => 3,
                "variable" => 6,
                "module" => 9,
                "type" => 7,
                "constructor" => 4,
                "keyword" => 14,
                _ => 1, // 1 = Text (fallback)
            };
            json!({
                "label": c.label,
                "kind": kind,
                "detail": if c.detail.is_empty() { Value::Null } else { Value::String(c.detail.clone()) },
            })
        })
        .collect()
}

fn byte_offset_to_lsp_pos(byte_offset: usize, text: &str) -> (usize, usize) {
    let clamped = byte_offset.min(text.len());
    let mut line = 0usize;
    let mut col = 0usize;
    for (idx, ch) in text.char_indices() {
        if idx >= clamped {
            return (line, col);
        }
        if ch == '\n' {
            line += 1;
            col = 0;
        } else {
            col += 1;
        }
    }
    (line, col)
}
