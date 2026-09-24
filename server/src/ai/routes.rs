use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::Event;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use tracing::warn;

use super::client::{
    Message, ask_llm_stream, error_event, failure_code, into_sse_response, require_ai_settings,
    setup_sse_channels, while_read,
};
use crate::AppState;
use crate::auth::role::Member;
use crate::settings::ai::AiProvider;

/// How many earlier messages of the conversation reach the model.
const HISTORY_WINDOW: usize = 10;

#[derive(Deserialize)]
struct LlmResponse {
    #[serde(default)]
    reasoning: String,
    sql: String,
    #[serde(default)]
    explanation: String,
}

#[derive(Debug, Clone, Copy, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    User,
    Assistant,
}

/// One earlier message of the conversation. The client keeps the conversation;
/// the server sees only what each ask carries.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AskRequest {
    pub question: String,
    pub provider: Option<AiProvider>,
    /// DuckDB DDL of the views the browser mounted: the whole of what the model
    /// knows about the data. Required unless `explain`.
    pub schema: Option<String>,
    /// When true, the model reads query results back instead of writing SQL;
    /// `question` then carries the question, the SQL and the rows.
    #[serde(default)]
    pub explain: bool,
    /// The conversation so far, oldest first.
    #[serde(default)]
    pub history: Vec<ChatMessage>,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/ask-stream", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = AskRequest,
    responses((status = 200, description = "SSE stream of LLM deltas", content_type = "text/event-stream"))
)]
pub async fn ask_discover_stream(
    member: Member,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<AskRequest>,
) -> Result<Response, Response> {
    crate::discovery::routes::output_ready(&state, &member, &id).await?;
    let ai_settings = require_ai_settings(state.db.ai_provider(req.provider).await)
        .map_err(IntoResponse::into_response)?;

    let (system_prompt, mut messages, max_tokens) = if req.explain {
        (EXPLAIN_PROMPT.to_string(), Vec::new(), 512)
    } else {
        let Some(schema) = req.schema.as_deref().filter(|s| !s.is_empty()) else {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(crate::error::error_body(
                    "schema_required",
                    "No DuckDB schema was sent. The client reads it from its own DuckDB catalog and must send it with the question.",
                )),
            )
                .into_response());
        };
        (system_prompt(schema), history(req.history), 2048)
    };
    messages.push(Message {
        role: "user".to_string(),
        content: req.question,
    });

    let ch = setup_sse_channels();
    let sse_tx = ch.sse_tx;
    let delta_tx = ch.delta_tx;
    let explain = req.explain;
    tokio::spawn(async move {
        let call = ask_llm_stream(
            &ai_settings,
            &system_prompt,
            &messages,
            Some(max_tokens),
            delta_tx,
        );
        let Some(result) = while_read(&sse_tx, call).await else {
            return;
        };
        let complete = match result {
            Ok(full_text) if explain => serde_json::json!({ "answer": full_text.trim() }),
            Ok(full_text) => {
                let (sql, explanation, reasoning) =
                    match serde_json::from_str::<LlmResponse>(strip_markdown_fences(&full_text)) {
                        Ok(resp) => (Some(resp.sql), resp.explanation, resp.reasoning),
                        Err(_) => (None, full_text, String::new()),
                    };
                let answer = if explanation.is_empty() {
                    "Here is a query for your data.".to_string()
                } else {
                    explanation
                };
                serde_json::json!({
                    "sql": sql,
                    "answer": answer,
                    "reasoning": (!reasoning.is_empty()).then_some(reasoning),
                })
            }
            Err(e) => {
                warn!("LLM stream failed: {e}");
                let _ = sse_tx
                    .send(Ok(error_event(failure_code(&e), &e.to_string())))
                    .await;
                return;
            }
        };
        let _ = sse_tx
            .send(Ok(Event::default()
                .event("complete")
                .data(complete.to_string())))
            .await;
    });

    Ok(into_sse_response(ch.sse_rx))
}

/// The last [`HISTORY_WINDOW`] messages, in order.
fn history(mut messages: Vec<ChatMessage>) -> Vec<Message> {
    let skip = messages.len().saturating_sub(HISTORY_WINDOW);
    messages
        .drain(skip..)
        .map(|m| Message {
            role: match m.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
            }
            .to_string(),
            content: m.content,
        })
        .collect()
}

/// The system prompt for the DuckDB SQL assistant.
///
/// `schema_context` is real DuckDB DDL, read by the browser out of its own
/// DuckDB catalog and sent with the question. The one thing DDL cannot carry is
/// that a join exists at all — the views have no foreign keys — so the prompt
/// keeps the traversal idiom and nothing else about the layout.
fn system_prompt(schema_context: &str) -> String {
    format!(
        "You are a DuckDB SQL query assistant operating over a property graph\n\
         loaded into DuckDB as views. The schema below is the whole of it: use\n\
         those tables and those columns, and invent no others.\n\n\
         ## Schema (live, read from DuckDB)\n\n\
         {schema_context}\n\n\
         ## Joining\n\
         A table whose columns are `\"source\"` and `\"target\"` is an edge table,\n\
         and its comment names the two vertex tables it connects. Both columns\n\
         hold `\"_id\"` values of those tables:\n\
         ```\n\
         SELECT t.*\n\
         FROM \"SourceTable\" s\n\
         JOIN \"EdgeTable\" e ON s.\"_id\" = e.\"source\"\n\
         JOIN \"TargetTable\" t ON t.\"_id\" = e.\"target\"\n\
         ```\n\n\
         ## DuckDB SQL rules\n\
         - Always quote identifiers with double quotes: `\"Table\".\"column\"`.\n\
         - Default to `LIMIT 100`; for top-N use `ORDER BY ... DESC LIMIT N`.\n\
         - Always include readable columns (subject, name, label, title) in SELECT.\n\
         - String match: `\"col\" ILIKE '%term%'`. Numeric: `\"col\" > N`, BETWEEN.\n\
         - Aggregation: `SELECT \"col\", COUNT(*) FROM \"Table\" GROUP BY \"col\"`.\n\
         - Date extraction: `EXTRACT(YEAR FROM \"col\")`, `DATE_TRUNC('month', \"col\")`.\n\
         - Casts may be required on property columns stored as VARCHAR\n\
           (e.g. `CAST(\"elementQuantity\" AS DOUBLE) > 0.5`).\n\n\
         Return ONLY a JSON object with these three fields:\n\
         - \"reasoning\": which tables/columns you chose and why,\n\
           which values/thresholds you derived from the sample data.\n\
         - \"sql\": a valid DuckDB SQL SELECT query.\n\
         - \"explanation\": one-sentence summary of what the query retrieves.\n\n\
         No markdown fences. No extra text."
    )
}

const EXPLAIN_PROMPT: &str = "You are a data analyst. The user will provide:\n\
     1. Their original question\n\
     2. The SQL query that was executed\n\
     3. The query results (first rows as JSON)\n\n\
     Write a concise natural-language summary of the findings in markdown.\n\
     Focus on key numbers, patterns, anomalies, and what the data means.\n\
     Be specific — reference actual values from the results.\n\
     Do NOT return JSON. Do NOT repeat the SQL. Plain markdown only.";

pub fn strip_markdown_fences(raw: &str) -> &str {
    let mid = raw
        .strip_prefix("```json")
        .or_else(|| raw.strip_prefix("```"))
        .unwrap_or(raw);
    mid.strip_suffix("```").unwrap_or(mid).trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(role: ChatRole, n: usize) -> ChatMessage {
        ChatMessage {
            role,
            content: format!("m{n}"),
        }
    }

    #[test]
    fn only_the_latest_window_of_history_reaches_the_model() {
        let sent: Vec<_> = (0..14)
            .map(|n| {
                said(
                    if n % 2 == 0 {
                        ChatRole::User
                    } else {
                        ChatRole::Assistant
                    },
                    n,
                )
            })
            .collect();
        let kept = history(sent);
        assert_eq!(kept.len(), HISTORY_WINDOW);
        assert_eq!(kept[0].content, "m4");
        assert_eq!(kept[0].role, "user");
        assert_eq!(kept[HISTORY_WINDOW - 1].content, "m13");
        assert_eq!(kept[HISTORY_WINDOW - 1].role, "assistant");
    }
}
