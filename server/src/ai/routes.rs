use std::fmt::Write as FmtWrite;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::response::sse::Event;
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::AppState;
use super::client::{AiError, Message, ask_llm_multi, ask_llm_stream, require_ai_settings, setup_sse_channels, into_sse_response};
use super::models::{AskResultCode, Conversation, ConversationMessage};
use crate::error::data_response;
use crate::middleware::tenant::{IsParticipant, Require};

#[derive(Deserialize)]
struct LlmResponse {
    #[serde(default)]
    reasoning: String,
    sql: String,
    #[serde(default)]
    explanation: String,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/ask", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = AskRequest,
    responses((status = 200, description = "AI answer with DuckDB SQL query", body = AskResponse))
)]
pub async fn ask_discover(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<AskRequest>,
) -> Response {
    if let Err(r) = crate::discovery::routes::require_output_ready(&state, &ctx, &id).await {
        return r;
    }

    let raw = if let Some(pid) = &req.provider {
        state.db.get_ai_provider(pid).await
    } else {
        state.db.list_ai_providers().await.into_iter().next()
    };
    let ai_settings = match require_ai_settings(raw) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };

    let schema_context = match &req.schema {
        Some(s) if !s.is_empty() => s.clone(),
        _ => {
            let job = match state.db.get_job(&ctx.scoped(id.as_str())).await {
                Some(j) => j,
                None => return (StatusCode::NOT_FOUND, Json(crate::error::error_body("not_found", "Job not found"))).into_response(),
            };
            build_pipeline_schema(&job.pipeline)
        }
    };

    let conversation_id = match req.conversation_id {
        Some(cid) => cid,
        None => {
            match state.db.create_conversation(&ctx.as_ctx(), &id, None).await {
                Ok(conv) => conv.id,
                Err(e) => {
                    warn!("Failed to create conversation: {e}");
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(crate::error::error_body("db_error", "Failed to create conversation"))).into_response();
                }
            }
        }
    };

    let history = state.db.get_messages(&conversation_id).await;
    if let Err(e) = state.db.add_message(&conversation_id, "user", &req.question, None, None, None).await {
        warn!("Failed to persist user message: {e}");
    }

    let mut messages = build_conversation_messages(&history);
    messages.push(Message {
        role: "user".to_string(),
        content: req.question.clone(),
    });

    let sql_system = build_system_prompt(&schema_context);

    let mut last_error: Option<String> = None;
    let mut parsed: Option<LlmResponse> = None;

    for attempt in 0..=1 {
        if let Some(err_msg) = &last_error {
            messages.push(Message {
                role: "user".to_string(),
                content: err_msg.clone(),
            });
        }

        let raw = match ask_llm_multi(&ai_settings, &sql_system, &messages, Some(2048)).await {
            Ok(s) => s.trim().to_string(),
            Err(e) => {
                let (code, answer) = match &e {
                    AiError::InsufficientCredits(_) => (
                        AskResultCode::InsufficientCredits,
                        "Your AI provider account has insufficient credits. Please check your billing settings.",
                    ),
                    AiError::RateLimit(_) => (
                        AskResultCode::LlmFailed,
                        "Rate limited by AI provider. Please wait a moment and try again.",
                    ),
                    AiError::Failed(_) => (
                        AskResultCode::LlmFailed,
                        "Something went wrong while generating a query. Please try again.",
                    ),
                };
                warn!("LLM call failed: {e}");
                if let Err(e) = state.db.add_message(&conversation_id, "assistant", answer, None, None, Some(code.as_str())).await {
                    warn!("Failed to persist error message: {e}");
                }
                return data_response(AskResponse {
                    answer: answer.to_string(),
                    sql: None,
                    conversation_id: Some(conversation_id),
                    code,
                    reasoning: None,
                }).into_response();
            }
        };

        let json_str = strip_markdown_fences(&raw);

        match serde_json::from_str::<LlmResponse>(json_str) {
            Ok(resp) => {
                debug!("SQL generated:\n{}", resp.sql);
                parsed = Some(resp);
                break;
            }
            Err(e) => {
                if attempt == 0 {
                    last_error = Some(format!(
                        "Invalid JSON response: {e}. Return ONLY a valid JSON object with \"reasoning\", \"sql\", and \"explanation\" fields."
                    ));
                    messages.push(Message {
                        role: "assistant".to_string(),
                        content: raw,
                    });
                    continue;
                }
                let answer = "I wasn't able to understand the data well enough to generate a query. Could you rephrase your question?".to_string();
                if let Err(e) = state.db.add_message(&conversation_id, "assistant", &answer, None, None, Some(AskResultCode::ParseFailed.as_str())).await {
                    warn!("Failed to persist error message: {e}");
                }
                return data_response(AskResponse {
                    answer,
                    sql: None,
                    conversation_id: Some(conversation_id),
                    code: AskResultCode::ParseFailed,
                    reasoning: None,
                }).into_response();
            }
        }
    }

    let parsed = match parsed {
        Some(p) => p,
        None => {
            let answer = "I wasn't able to generate a working query. Could you rephrase your question?".to_string();
            if let Err(e) = state.db.add_message(&conversation_id, "assistant", &answer, None, None, Some(AskResultCode::ParseFailed.as_str())).await {
                warn!("Failed to persist error message: {e}");
            }
            return data_response(AskResponse {
                answer,
                sql: None,
                conversation_id: Some(conversation_id),
                code: AskResultCode::ParseFailed,
                reasoning: None,
            }).into_response();
        }
    };

    let answer = if parsed.explanation.is_empty() {
        "Here is a query for your data.".to_string()
    } else {
        parsed.explanation.clone()
    };

    if let Err(e) = state.db.add_message(&conversation_id, "assistant", &answer, Some(&parsed.sql), None, Some(AskResultCode::Success.as_str())).await {
        warn!("Failed to persist assistant message: {e}");
    }

    data_response(AskResponse {
        answer,
        sql: Some(parsed.sql),
        conversation_id: Some(conversation_id),
        code: AskResultCode::Success,
        reasoning: if parsed.reasoning.is_empty() { None } else { Some(parsed.reasoning) },
    }).into_response()
}

// ── Streaming endpoint ───────────────────────────────────────────────────

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/ask-stream", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = AskRequest,
    responses((status = 200, description = "SSE stream of LLM deltas", content_type = "text/event-stream"))
)]
pub async fn ask_discover_stream(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<AskRequest>,
) -> Response {
    if let Err(r) = crate::discovery::routes::require_output_ready(&state, &ctx, &id).await {
        return r;
    }

    let raw = if let Some(pid) = &req.provider {
        state.db.get_ai_provider(pid).await
    } else {
        state.db.list_ai_providers().await.into_iter().next()
    };
    let ai_settings = match require_ai_settings(raw) {
        Ok(s) => s,
        Err(e) => return e.into_response(),
    };

    let schema_context = match &req.schema {
        Some(s) if !s.is_empty() => s.clone(),
        _ => {
            let job = match state.db.get_job(&ctx.scoped(id.as_str())).await {
                Some(j) => j,
                None => return (StatusCode::NOT_FOUND, Json(crate::error::error_body("not_found", "Job not found"))).into_response(),
            };
            build_pipeline_schema(&job.pipeline)
        }
    };

    let is_explain = req.explain;

    let conversation_id = match req.conversation_id {
        Some(cid) => cid,
        None => {
            match state.db.create_conversation(&ctx.as_ctx(), &id, None).await {
                Ok(conv) => conv.id,
                Err(e) => {
                    warn!("Failed to create conversation: {e}");
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(crate::error::error_body("db_error", "Failed to create conversation"))).into_response();
                }
            }
        }
    };

    let history = state.db.get_messages(&conversation_id).await;

    // Don't persist the explain prompt as a user message
    if !is_explain {
        if let Err(e) = state.db.add_message(&conversation_id, "user", &req.question, None, None, None).await {
            warn!("Failed to persist user message: {e}");
        }
    }

    // Explain is self-contained; don't load conversation history
    let mut messages = if is_explain {
        vec![]
    } else {
        build_conversation_messages(&history)
    };
    messages.push(Message { role: "user".to_string(), content: req.question.clone() });

    let system_prompt = if is_explain {
        build_explain_prompt()
    } else {
        build_system_prompt(&schema_context)
    };

    // Open SSE channel (shared infrastructure)
    let ch = setup_sse_channels();
    let sse_tx = ch.sse_tx;

    // Send conversation_id immediately
    let conv_id = conversation_id.clone();
    let _ = sse_tx.send(Ok(
        Event::default()
            .event("conversation")
            .data(serde_json::json!({"conversation_id": conv_id}).to_string())
    )).await;

    // Run LLM in background, then parse and send complete event
    let max_tokens = if is_explain { Some(512) } else { Some(2048) };
    let db = state.db.clone();
    let delta_tx = ch.delta_tx;
    tokio::spawn(async move {
        let result = ask_llm_stream(&ai_settings, &system_prompt, &messages, max_tokens, None, delta_tx).await;

        match result {
            Ok(full_text) => {
                if is_explain {
                    let explanation = full_text.trim().to_string();
                    let msgs = db.get_messages(&conversation_id).await;
                    if let Some(last_assistant) = msgs.iter().rev().find(|m| m.role == "assistant") {
                        if let Err(e) = db.update_message_explanation(&last_assistant.id, &explanation).await {
                            warn!("Failed to update explanation: {e}");
                        }
                    }
                    let complete = serde_json::json!({
                        "answer": explanation,
                        "conversation_id": conversation_id,
                        "code": AskResultCode::Success.as_str(),
                    });
                    let _ = sse_tx.send(Ok(Event::default().event("complete").data(complete.to_string()))).await;
                } else {
                    let json_str = strip_markdown_fences(&full_text);
                    let (sql, explanation, reasoning) = match serde_json::from_str::<LlmResponse>(json_str) {
                        Ok(resp) => (Some(resp.sql.clone()), resp.explanation, resp.reasoning),
                        Err(_) => (None, full_text.clone(), String::new()),
                    };

                    let answer = if explanation.is_empty() { "Here is a query for your data.".to_string() } else { explanation };
                    if let Err(e) = db.add_message(&conversation_id, "assistant", &answer, sql.as_deref(), None, Some(AskResultCode::Success.as_str())).await {
                        warn!("Failed to persist assistant message: {e}");
                    }

                    let complete = serde_json::json!({
                        "sql": sql,
                        "answer": answer,
                        "conversation_id": conversation_id,
                        "reasoning": if reasoning.is_empty() { None } else { Some(reasoning) },
                        "code": AskResultCode::Success.as_str(),
                    });
                    let _ = sse_tx.send(Ok(Event::default().event("complete").data(complete.to_string()))).await;
                }
            }
            Err(e) => {
                let (code, msg) = match &e {
                    AiError::InsufficientCredits(_) => (AskResultCode::InsufficientCredits.as_str(), "Insufficient credits."),
                    AiError::RateLimit(_) => (AskResultCode::LlmFailed.as_str(), "Rate limited. Please wait and try again."),
                    AiError::Failed(_) => (AskResultCode::LlmFailed.as_str(), "LLM call failed."),
                };
                warn!("LLM stream failed: {e}");
                if let Err(e) = db.add_message(&conversation_id, "assistant", msg, None, None, Some(code)).await {
                    warn!("Failed to persist error message: {e}");
                }
                let err = serde_json::json!({"code": code, "answer": msg});
                let _ = sse_tx.send(Ok(Event::default().event("error").data(err.to_string()))).await;
            }
        }
    });

    into_sse_response(ch.sse_rx)
}

/// Build the system prompt for the DuckDB SQL assistant.
///
/// The `schema_context` is expected to contain real DuckDB DDL (CREATE TABLE
/// statements) and sample rows, sent by the frontend after querying DuckDB-WASM.
fn build_system_prompt(schema_context: &str) -> String {
    format!(
        "You are a DuckDB SQL query assistant.\n\n\
         The data is stored in Parquet files loaded into DuckDB as multiple tables.\n\
         Each table represents an entity type (e.g. person, organization).\n\
         The schema below shows CREATE TABLE statements, sample rows, and relationships.\n\n\
         {schema_context}\n\n\
         ## DuckDB SQL Rules\n\
         - Always quote table and column names with double quotes: \"table\".\"column\"\n\
         - Use LIMIT 100 by default unless the user asks for all results.\n\
         - For top-N queries, use ORDER BY ... DESC LIMIT N.\n\
         - Always include readable columns (name, label, title) in SELECT when available.\n\
         - Use sample rows to understand the data format and choose appropriate filters.\n\
         - String matching: \"col\" ILIKE '%term%'\n\
         - Numeric filter: \"col\" > N, \"col\" BETWEEN a AND b\n\
         - Aggregation: SELECT \"col\", COUNT(*) FROM \"table\" GROUP BY \"col\"\n\
         - Date filter: \"col\" >= '2024-01-01'\n\
         - Date extraction: EXTRACT(YEAR FROM \"col\"), DATE_TRUNC('month', \"col\")\n\
         - CASE expressions: CASE WHEN ... THEN ... END\n\
         - To join across entity types, use the edge tables shown in relationships.\n\n\
         Return ONLY a JSON object with these three fields:\n\
         - \"reasoning\": step-by-step explanation — which tables/columns you chose,\n\
           which values/thresholds you derived from the sample data, and why.\n\
         - \"sql\": a valid DuckDB SQL SELECT query.\n\
         - \"explanation\": one-sentence summary of what the query retrieves.\n\n\
         No markdown fences. No extra text."
    )
}

/// Build the system prompt for the explain pass (data analyst mode).
fn build_explain_prompt() -> String {
    "You are a data analyst. The user will provide:\n\
     1. Their original question\n\
     2. The SQL query that was executed\n\
     3. The query results (first rows as JSON)\n\n\
     Write a concise natural-language summary of the findings in markdown.\n\
     Focus on key numbers, patterns, anomalies, and what the data means.\n\
     Be specific — reference actual values from the results.\n\
     Do NOT return JSON. Do NOT repeat the SQL. Plain markdown only."
        .to_string()
}

/// Build a minimal schema description from the pipeline summary (fallback when
/// the frontend doesn't send a DuckDB schema).
fn build_pipeline_schema(pipeline: &crate::jobs::PipelineSummary) -> String {
    use std::fmt::Write;
    let mut out = String::from("## Table: rdf\n\nColumns:\n");
    for output in &pipeline.outputs {
        for field in &output.fields {
            let opt = if field.optional { " (nullable)" } else { "" };
            let _ = writeln!(out, "- {}: {}{}", field.name, field.field_type, opt);
        }
    }
    out
}

/// Build LLM message history from conversation messages.
fn build_conversation_messages(history: &[ConversationMessage]) -> Vec<Message> {
    let recent = if history.len() > 10 {
        &history[history.len() - 10..]
    } else {
        history
    };

    recent
        .iter()
        .map(|msg| {
            let content = if msg.role == "assistant" {
                let mut condensed = String::new();
                let answer_preview: String = msg.content.chars().take(200).collect();
                let _ = write!(condensed, "[Answer: {answer_preview}]");
                if let Some(sql) = &msg.sql {
                    let sql_preview: String = sql.chars().take(200).collect();
                    let _ = write!(condensed, " [SQL: {sql_preview}]");
                }
                condensed
            } else {
                msg.content.clone()
            };
            Message {
                role: msg.role.clone(),
                content,
            }
        })
        .collect()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct CreateConversationRequest {
    pub title: Option<String>,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/conversations", tag = "Conversations",
    params(("id" = String, Path, description = "Job ID")),
    request_body = CreateConversationRequest,
    responses((status = 201, description = "Conversation created", body = crate::ai::models::Conversation))
)]
pub async fn create_conversation(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    Json(req): Json<CreateConversationRequest>,
) -> Response {
    if state.db.get_job(&ctx.scoped(job_id.as_str())).await.is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(crate::error::error_body("not_found", "Job not found")),
        )
            .into_response();
    }
    match state.db.create_conversation(&ctx.as_ctx(), &job_id, req.title).await {
        Ok(conv) => (StatusCode::CREATED, data_response(conv)).into_response(),
        Err(e) => {
            warn!("Failed to create conversation: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(crate::error::error_body("db_error", "Failed to create conversation"))).into_response()
        }
    }
}

#[utoipa::path(get, path = "/v1/jobs/{id}/conversations", tag = "Conversations",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "List of conversations", body = Vec<crate::ai::models::Conversation>))
)]
pub async fn list_conversations(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    let convs: Vec<Conversation> = state.db.list_conversations(&ctx.as_ctx(), &job_id).await;
    data_response(convs)
}

#[utoipa::path(get, path = "/v1/conversations/{id}/messages", tag = "Conversations",
    params(("id" = String, Path, description = "Conversation ID")),
    responses(
        (status = 200, description = "Conversation messages", body = Vec<crate::ai::models::ConversationMessage>),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get_conversation_messages(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
) -> Response {
    if state.db.get_conversation(&conversation_id, ctx.org_id.as_str()).await.is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(crate::error::error_body("not_found", "Conversation not found")),
        ).into_response();
    }
    let messages: Vec<ConversationMessage> = state.db.get_messages(&conversation_id).await;
    data_response(messages).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct RenameConversationRequest {
    pub title: String,
}

#[utoipa::path(put, path = "/v1/conversations/{id}", tag = "Conversations",
    params(("id" = String, Path, description = "Conversation ID")),
    request_body = RenameConversationRequest,
    responses((status = 204, description = "Conversation renamed"))
)]
pub async fn rename_conversation(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
    Json(req): Json<RenameConversationRequest>,
) -> Response {
    if req.title.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(crate::error::error_body("validation_error", "title is required")),
        )
            .into_response();
    }
    if let Err(e) = state.db.rename_conversation(&conversation_id, ctx.org_id.as_str(), req.title.trim()).await {
        warn!("Failed to rename conversation: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(crate::error::error_body("db_error", "Failed to rename conversation"))).into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

#[utoipa::path(delete, path = "/v1/conversations/{id}", tag = "Conversations",
    params(("id" = String, Path, description = "Conversation ID")),
    responses((status = 204, description = "Conversation deleted"))
)]
pub async fn delete_conversation(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
) -> Response {
    if let Err(e) = state.db.delete_conversation(&conversation_id, ctx.org_id.as_str()).await {
        warn!("Failed to delete conversation: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(crate::error::error_body("db_error", "Failed to delete conversation"))).into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AskRequest {
    pub question: String,
    pub conversation_id: Option<String>,
    pub provider: Option<String>,
    /// DuckDB table schema from the frontend (column names, types, sample values).
    /// When provided, this is used as context for SQL generation instead of the
    /// pipeline summary.
    pub schema: Option<String>,
    /// When true, the LLM acts as a data analyst explaining query results
    /// instead of generating SQL. The question should contain the original
    /// question, SQL, and result rows.
    #[serde(default)]
    pub explain: bool,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct AskResponse {
    pub answer: String,
    /// DuckDB SQL query generated by the LLM (executed client-side via DuckDB-WASM).
    pub sql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    pub code: AskResultCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

/// Extract JSON from LLM output — handles fences, preamble text, etc.
pub fn strip_markdown_fences(raw: &str) -> &str {
    // Try fenced json block anywhere in text
    if let Some(start) = raw.find("```json") {
        let after = &raw[start + 7..];
        if let Some(end) = after.find("```") {
            return after[..end].trim();
        }
    }
    if let Some(start) = raw.find("```") {
        let after = &raw[start + 3..];
        if let Some(end) = after.find("```") {
            return after[..end].trim();
        }
    }
    // Try raw JSON object
    if let Some(start) = raw.find('{') {
        if let Some(end) = raw.rfind('}') {
            return &raw[start..=end];
        }
    }
    raw.trim()
}
