//! MCP client — spawn `fossil-mcp` and dispatch a verb over stdio.
//!
//! Host-boundary: keasy links NO fossil compiler/runtime crate. It talks to the
//! verb service as a subprocess (like `fossil run`), here over MCP. `dataset`
//! and `operation` are plain JSON, so no `fossil-graph` type ever leaks into
//! keasy. Used for owner-gated `execute_sql` today; reusable for the `/ask`
//! tool-loop later.

use rmcp::ServiceExt;
use rmcp::model::CallToolRequestParams;
use rmcp::transport::TokioChildProcess;
use serde_json::Value;
use tokio::process::Command;

/// The `fossil-mcp` binary: `$FOSSIL_MCP_BIN` or `fossil-mcp` on `PATH`.
fn mcp_bin() -> String {
    std::env::var("FOSSIL_MCP_BIN").unwrap_or_else(|_| "fossil-mcp".to_string())
}

/// Spawn `fossil-mcp`, call its `dispatch_verb` tool with `{dataset, operation}`,
/// and return the verb's JSON result. The child is shut down when the client is
/// dropped at the end of this call (one-shot).
///
/// # Errors
///
/// Returns a stringified error on spawn, MCP handshake, tool-call, or a verb
/// error (`is_error`) / unparseable result.
pub async fn dispatch_verb(dataset: Value, operation: Value) -> Result<Value, String> {
    let mut cmd = Command::new(mcp_bin());
    cmd.kill_on_drop(true);
    let transport = TokioChildProcess::new(cmd).map_err(|e| format!("spawn fossil-mcp: {e}"))?;
    let client = ()
        .serve(transport)
        .await
        .map_err(|e| format!("fossil-mcp handshake: {e}"))?;

    let arguments = serde_json::json!({ "dataset": dataset, "operation": operation })
        .as_object()
        .cloned();
    let result = client
        .call_tool(CallToolRequestParams {
            name: "dispatch_verb".into(),
            arguments,
            meta: None,
            task: None,
        })
        .await
        .map_err(|e| format!("fossil-mcp call_tool: {e}"))?;

    if result.is_error == Some(true) {
        let msg = result
            .content
            .first()
            .and_then(|c| c.as_text())
            .map(|t| t.text.clone())
            .unwrap_or_default();
        return Err(format!("verb error: {msg}"));
    }

    if let Some(structured) = result.structured_content {
        return Ok(structured);
    }
    let text = result
        .content
        .first()
        .and_then(|c| c.as_text())
        .ok_or_else(|| "empty fossil-mcp tool result".to_string())?;
    serde_json::from_str(&text.text).map_err(|e| format!("parse verb result: {e}"))
}
