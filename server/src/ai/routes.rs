use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use std::fmt::Write as FmtWrite;

use tracing::warn;

use crate::AppState;
use super::client::{AiError, ask_llm};
use super::models::{Conversation, ConversationMessage};
use crate::error::data_response;
use crate::jobs::PipelineSummary;
use crate::middleware::tenant::RequireParticipant;

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/ask", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = AskRequest,
    responses((status = 200, description = "AI answer with optional SPARQL results", body = AskResponse))
)]
pub async fn ask_discover(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<AskRequest>,
) -> Response {
    let output_graph = match crate::discovery::routes::require_output_ready(&state, &ctx, &id).await {
        Ok(g) => g,
        Err(r) => return r,
    };

    let ai_settings = if let Some(pid) = &req.provider {
        state.db.get_ai_provider(pid).await
    } else {
        state.db.list_ai_providers().await.into_iter().next()
    };
    let ai_settings = match ai_settings {
        Some(s) if !s.api_key.expose_secret().is_empty() => s,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(crate::error::error_body(
                    "ai_not_configured",
                    "AI settings are not configured. Go to Settings > AI to add an API key.",
                )),
            )
                .into_response();
        }
    };

    let job = match state.db.get_job(&ctx.scoped(id.as_str())).await {
        Some(j) => j,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(crate::error::error_body("not_found", "Job not found")),
            )
                .into_response();
        }
    };

    let schema = build_schema_context(&job.pipeline);

    let conversation_id = match req.conversation_id {
        Some(cid) => cid,
        None => {
            let conv = state.db.create_conversation(&ctx.as_ctx(), &id, None).await;
            conv.id
        }
    };

    state.db.add_message(&conversation_id, "user", &req.question, None, None, None).await;

    let sparql_system = format!(
        "You are a SPARQL query assistant for an RDF knowledge graph.\n\
         The data was generated from typed fossil-lang records. Below is the schema with types, \
         fields, their RDF predicate URIs, and primitive types.\n\n\
         Respond with a JSON object containing exactly two fields:\n\
         - \"sparql\": a SPARQL SELECT query that answers the user's question\n\
         - \"explanation\": a brief explanation of how the query answers the question, \
         referencing the specific types, fields, and predicates used from the schema\n\n\
         Return ONLY valid JSON. No markdown fences, no extra text.\n\n\
         {schema}"
    );

    let raw = match ask_llm(&ai_settings, &sparql_system, &req.question).await {
        Ok(s) => s.trim().to_string(),
        Err(e) => {
            let (code, answer) = match &e {
                AiError::InsufficientCredits(_) => (
                    "insufficient_credits",
                    "Your AI provider account has insufficient credits. Please check your billing settings.",
                ),
                AiError::Failed(_) => (
                    "llm_failed",
                    "Something went wrong while generating a query. Please try again.",
                ),
            };
            warn!("LLM call failed: {e}");
            state.db.add_message(&conversation_id, "assistant", answer, None, None, Some(code)).await;
            return data_response(AskResponse {
                answer: answer.to_string(),
                sparql: None,
                data: None,
                conversation_id: Some(conversation_id),
                code: code.to_string(),
            }).into_response();
        }
    };

    #[derive(Deserialize)]
    struct LlmResponse {
        sparql: String,
        #[serde(default)]
        explanation: String,
    }

    let json_str = strip_markdown_fences(&raw);

    let parsed = match serde_json::from_str::<LlmResponse>(json_str) {
        Ok(p) => p,
        Err(_) => {
            let answer = "I wasn't able to understand the data well enough to generate a query. Could you rephrase your question?".to_string();
            state.db.add_message(&conversation_id, "assistant", &answer, None, None, Some("parse_failed")).await;
            return data_response(AskResponse {
                answer,
                sparql: None,
                data: None,
                conversation_id: Some(conversation_id),
                code: "parse_failed".to_string(),
            }).into_response();
        }
    };

    let sparql = format_sparql(&parsed.sparql);

    let data = match state.graph_store.sparql_select(&sparql, Some(&output_graph)) {
        Ok(data) => Some(data),
        Err(err) => {
            warn!("SPARQL execution failed: {err}");
            let answer = "I generated a query but it didn't work against your data. Try rephrasing your question.".to_string();
            state.db.add_message(&conversation_id, "assistant", &answer, Some(&sparql), None, Some("sparql_failed")).await;
            return data_response(AskResponse {
                answer,
                sparql: Some(sparql),
                data: None,
                conversation_id: Some(conversation_id),
                code: "sparql_failed".to_string(),
            }).into_response();
        }
    };

    let has_rows = data.as_ref().is_some_and(|d| !d.rows.is_empty());

    let answer = if has_rows {
        let table_text = summarize_results_for_llm(data.as_ref().unwrap());
        let summary_system = format!(
            "You are a data analyst assistant. The user asked a question about their data.\n\
             A SPARQL query was executed and returned the results below.\n\n\
             Summarize the results in clear, natural language. Be concise and direct.\n\
             Do not include SPARQL or technical details — just a plain language answer.\n\n\
             Results:\n{table_text}"
        );
        match ask_llm(&ai_settings, &summary_system, &req.question).await {
            Ok(summary) => summary.trim().to_string(),
            Err(_) => {
                if parsed.explanation.is_empty() {
                    "Here are the results from your query.".to_string()
                } else {
                    parsed.explanation
                }
            }
        }
    } else {
        "No data matched your query. Try rephrasing your question.".to_string()
    };

    state.db.add_message(&conversation_id, "assistant", &answer, Some(&sparql), data.as_ref(), Some("success")).await;

    data_response(AskResponse {
        answer,
        sparql: Some(sparql),
        data,
        conversation_id: Some(conversation_id),
        code: "success".to_string(),
    }).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct CreateConversationRequest {
    pub title: Option<String>,
}

#[utoipa::path(post, path = "/v1/jobs/{id}/conversations", tag = "Conversations",
    params(("id" = String, Path, description = "Job ID")),
    request_body = CreateConversationRequest,
    responses((status = 201, description = "Conversation created"))
)]
pub async fn create_conversation(
    RequireParticipant(ctx): RequireParticipant,
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
    let conv = state.db.create_conversation(&ctx.as_ctx(), &job_id, req.title).await;
    (StatusCode::CREATED, data_response(conv)).into_response()
}

#[utoipa::path(get, path = "/v1/jobs/{id}/conversations", tag = "Conversations",
    params(("id" = String, Path, description = "Job ID")),
    responses((status = 200, description = "List of conversations"))
)]
pub async fn list_conversations(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    let convs: Vec<Conversation> = state.db.list_conversations(&ctx.as_ctx(), &job_id).await;
    data_response(convs)
}

#[utoipa::path(get, path = "/v1/conversations/{id}/messages", tag = "Conversations",
    params(("id" = String, Path, description = "Conversation ID")),
    responses((status = 200, description = "Conversation messages"), (status = 404, description = "Not found"))
)]
pub async fn get_conversation_messages(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
) -> Response {
    // Verify the conversation belongs to this org before returning messages
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
    RequireParticipant(ctx): RequireParticipant,
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
    state.db.rename_conversation(&conversation_id, ctx.org_id.as_str(), req.title.trim()).await;
    StatusCode::NO_CONTENT.into_response()
}

#[utoipa::path(delete, path = "/v1/conversations/{id}", tag = "Conversations",
    params(("id" = String, Path, description = "Conversation ID")),
    responses((status = 204, description = "Conversation deleted"))
)]
pub async fn delete_conversation(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
) -> impl IntoResponse {
    state.db.delete_conversation(&conversation_id, ctx.org_id.as_str()).await;
    StatusCode::NO_CONTENT
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AskRequest {
    pub question: String,
    pub conversation_id: Option<String>,
    pub provider: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct AskResponse {
    pub answer: String,
    pub sparql: Option<String>,
    #[schema(value_type = Option<Object>)]
    pub data: Option<crate::discovery::graph_types::TabularData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    pub code: String,
}

fn strip_markdown_fences(raw: &str) -> &str {
    let mid = raw
        .strip_prefix("```json")
        .or_else(|| raw.strip_prefix("```"))
        .unwrap_or(raw);
    mid.strip_suffix("```").unwrap_or(mid).trim()
}

fn format_sparql(sparql: &str) -> String {
    let collapsed: String = sparql.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut result = collapsed;
    for kw in &["SELECT", "CONSTRUCT", "WHERE", "FILTER", "OPTIONAL", "UNION", "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "OFFSET", "PREFIX", "BIND"] {
        result = result.replace(&format!(" {kw}"), &format!("\n{kw}"));
    }
    result.trim().to_string()
}

fn build_schema_context(pipeline: &PipelineSummary) -> String {
    let mut schema = String::from("Schema:\n");

    if !pipeline.inputs.is_empty() {
        let _ = writeln!(schema, "\n## Data Sources");
        for src in &pipeline.inputs {
            let _ = writeln!(schema, "  Source: {}", src.name);
            if !src.fields.is_empty() {
                let field_names: Vec<&str> = src.fields.iter().map(|f| f.name.as_str()).collect();
                let _ = writeln!(schema, "    Fields: {}", field_names.join(", "));
            }
        }
    }

    let join_ops: Vec<_> = pipeline.operations.iter()
        .filter(|op| op.kind == "join")
        .collect();

    if !join_ops.is_empty() {
        let _ = writeln!(schema, "\n## Joins");
        for op in &join_ops {
            let left = op.inputs.first().map(|i| i.source.as_str()).unwrap_or("?");
            let right = op.inputs.get(1).map(|i| i.source.as_str()).unwrap_or("?");
            let left_on = op.inputs.first().map(|i| &i.key_fields).cloned().unwrap_or_default();
            let right_on = op.inputs.get(1).map(|i| &i.key_fields).cloned().unwrap_or_default();
            let on_clause: Vec<String> = left_on.iter().zip(right_on.iter())
                .map(|(l, r)| format!("{l} = {r}"))
                .collect();
            let _ = writeln!(
                schema,
                "  {} {} {} ON {}",
                left, op.label, right, on_clause.join(", ")
            );
        }
    }

    let (ref_types, regular_outputs): (Vec<_>, Vec<_>) = pipeline.outputs.iter()
        .partition(|o| o.fields.is_empty() && o.rdf_type.is_some());

    if !regular_outputs.is_empty() {
        let _ = writeln!(schema, "\n## Output Types");
        for output in &regular_outputs {
            let _ = writeln!(schema, "\nType: {}", output.type_name);
            for field in &output.fields {
                match &field.uri {
                    Some(u) => { let _ = writeln!(schema, "  - {}: {} → <{}>", field.name, field.field_type, u); }
                    None => { let _ = writeln!(schema, "  - {}: {}", field.name, field.field_type); }
                }
            }
            if !output.mappings.is_empty() {
                let _ = writeln!(schema, "  Mappings (source field → output field):");
                for m in &output.mappings {
                    let _ = writeln!(schema, "    {} ← {}", m.target, m.source);
                }
            }
        }
    }

    if !ref_types.is_empty() {
        let _ = writeln!(schema, "\n## Reference Types (cross-reference nodes)");
        let _ = writeln!(schema, "These nodes only have an rdf:type triple and incoming links from other types.");
        let _ = writeln!(schema, "They have NO field predicates — query them via rdf:type and incoming references.");
        for rt in &ref_types {
            let rdf = rt.rdf_type.as_deref().unwrap_or("(no rdf:type)");
            let params: Vec<&str> = rt.mappings.iter().map(|m| m.target.as_str()).collect();
            let _ = writeln!(schema, "  {}({}) → <{}>", rt.type_name, params.join(", "), rdf);
        }
    }

    schema
}

fn summarize_results_for_llm(data: &crate::discovery::graph_types::TabularData) -> String {
    let total = data.rows.len();
    let preview_rows = &data.rows[..total.min(20)];
    let mut out = String::new();
    let _ = writeln!(out, "{total} row(s) returned. Columns: {}", data.columns.join(", "));
    for row in preview_rows {
        let cells: Vec<String> = data.columns.iter().map(|col| {
            match row.get(col) {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Number(n)) => n.to_string(),
                Some(other) => other.to_string(),
                None => String::new(),
            }
        }).collect();
        let _ = writeln!(out, "  {}", cells.join(" | "));
    }
    if total > 20 {
        let _ = writeln!(out, "  ... and {} more rows", total - 20);
    }
    out
}

