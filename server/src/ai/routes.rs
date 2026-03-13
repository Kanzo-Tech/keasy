use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};

use std::fmt::Write as FmtWrite;

use tracing::{debug, warn};

use crate::AppState;
use crate::graph::dataset::Dataset;
use super::client::{AiError, Message, ask_llm, ask_llm_multi};
use super::context::build_semantic_context;
use super::models::{AskResultCode, Conversation, ConversationMessage};
use crate::error::data_response;
use crate::middleware::tenant::{IsParticipant, Require};

#[utoipa::path(post, path = "/v1/jobs/{id}/discover/ask", tag = "Discovery",
    params(("id" = String, Path, description = "Job ID")),
    request_body = AskRequest,
    responses((status = 200, description = "AI answer with optional SPARQL results", body = AskResponse))
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

    // Load fragment dataset and build profile
    let dataset = {
        let base_url = job.rdf_base.as_deref().unwrap_or("");
        if base_url.is_empty() {
            crate::graph::fragment::FragmentDataset::empty()
        } else {
            let creds = state.db.build_storage_config(&ctx.scoped(()), &ctx.org_id.0, &job.connection_ids).await;
            match state.fragment_resolver.resolve_dataset(base_url, &creds).await {
                Ok(ds) => ds,
                Err(e) => {
                    warn!("Failed to load fragment dataset: {e}");
                    crate::graph::fragment::FragmentDataset::empty()
                }
            }
        }
    };
    let profile = crate::ai::profiler::GraphProfile::build_from_dataset(&dataset, &id);
    let semantic_context = build_semantic_context(&job.pipeline, &profile);
    debug!("--- Semantic Context ---\n{semantic_context}\n--- End Context ---");

    let conversation_id = match req.conversation_id {
        Some(cid) => cid,
        None => {
            let conv = state.db.create_conversation(&ctx.as_ctx(), &id, None).await;
            conv.id
        }
    };

    // Build conversation history BEFORE inserting the new message to avoid a
    // write-then-read round-trip (we already have the question in memory).
    let history = state.db.get_messages(&conversation_id).await;
    state.db.add_message(&conversation_id, "user", &req.question, None, None, None).await;

    let mut messages = build_conversation_messages(&history);
    // Append the current question (we fetched history before insert)
    messages.push(Message {
        role: "user".to_string(),
        content: req.question.clone(),
    });

    // If messages only has the current question (fresh conversation), ensure it's present
    if messages.len() == 1 && messages[0].role != "user" {
        messages.push(Message {
            role: "user".to_string(),
            content: req.question.clone(),
        });
    }

    let sparql_system = format!(
        "You are a SPARQL query assistant.\n\n\
         The data was produced by Fossil, a statically typed data language.\n\
         The schema below defines the types and their fields — treat it as the\n\
         definitive source of truth for what exists in the data.\n\n\
         ## Schema Guide\n\
         - Each **Output Type** has a type name and optionally a graph URI in brackets.\n\
           If a graph URI is shown (e.g. Type: Foo [<http://…>]):\n\
             query with `?s a <graph_uri> .`\n\
           If NO graph URI is shown: do NOT use `?s a <…>` — instead identify\n\
             subjects solely by their field predicates.\n\
         - Each **field** has a name, data type, required/optional status, and a predicate URI.\n\
           To access a field: `?s <predicate_uri> ?variable .`\n\
         - The **↳** lines show real data statistics collected from the graph:\n\
             Numeric → count, coverage %, min–max range, average.\n\
             Categorical → count, coverage %, distinct count, top values with frequencies.\n\
             Text → count, coverage %, sample values.\n\n\
         ## Before Writing SPARQL\n\
         1. Identify which Output Type the question is about.\n\
         2. Read ALL fields and their statistics for that type.\n\
         3. For each concept in the question, find the matching field:\n\
            - Categorical: pick the closest value from the top-values list\n\
              (consider synonyms, translations, abbreviations).\n\
              Use the exact casing shown in the statistics.\n\
            - Numeric with vague qualifiers (\"tall\", \"heavy\", \"expensive\"):\n\
              derive a threshold from the field's min/max/avg\n\
              (typically top or bottom 15-20% of the range).\n\
            - Composite or slang terms that imply multiple traits:\n\
              decompose into individual field filters combined with AND.\n\
         4. Only use predicate URIs from the schema — never invent URIs.\n\
         5. Always include human-readable fields (name, label, title) in SELECT.\n\n\
         ## SPARQL Patterns\n\
         Always declare every PREFIX you use (e.g. PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>).\n\
         - Numeric:  FILTER(xsd:double(?val) > N)\n\
         - Exact:    FILTER(STR(?val) = \"Value\")\n\
         - Contains: FILTER(CONTAINS(LCASE(STR(?val)), \"term\"))\n\
         - Multi:    FILTER(xsd:double(?a) > X && xsd:double(?b) > Y)\n\
         - Optional: OPTIONAL {{ ?s <pred> ?val }} FILTER(!BOUND(?val) || condition)\n\n\
         {semantic_context}\n\n\
         Return ONLY a JSON object with these three fields:\n\
         - \"reasoning\": step-by-step explanation — which type and fields you chose,\n\
           which values/thresholds you derived from the statistics, and why.\n\
         - \"sparql\": a valid SPARQL SELECT query.\n\
         - \"explanation\": one-sentence summary of what the query retrieves.\n\n\
         No markdown fences. No extra text."
    );

    // Error recovery loop: up to 2 attempts
    #[derive(Deserialize)]
    struct LlmResponse {
        #[serde(default)]
        reasoning: String,
        sparql: String,
        #[serde(default)]
        explanation: String,
    }

    let mut last_error: Option<String> = None;
    let mut parsed: Option<LlmResponse> = None;
    let mut validated_data: Option<crate::graph::types::TabularData> = None;

    for attempt in 0..=1 {
        // If retrying, inject error feedback
        if let Some(err_msg) = &last_error {
            messages.push(Message {
                role: "user".to_string(),
                content: err_msg.clone(),
            });
        }

        let raw = match ask_llm_multi(&ai_settings, &sparql_system, &messages, Some(2048)).await {
            Ok(s) => s.trim().to_string(),
            Err(e) => {
                let (code, answer) = match &e {
                    AiError::InsufficientCredits(_) => (
                        AskResultCode::InsufficientCredits,
                        "Your AI provider account has insufficient credits. Please check your billing settings.",
                    ),
                    AiError::Failed(_) => (
                        AskResultCode::LlmFailed,
                        "Something went wrong while generating a query. Please try again.",
                    ),
                };
                warn!("LLM call failed: {e}");
                state.db.add_message(&conversation_id, "assistant", answer, None, None, Some(code.as_str())).await;
                return data_response(AskResponse {
                    answer: answer.to_string(),
                    sparql: None,
                    data: None,
                    conversation_id: Some(conversation_id),
                    code,
                    reasoning: None,
                }).into_response();
            }
        };

        let json_str = strip_markdown_fences(&raw);

        let llm_resp = match serde_json::from_str::<LlmResponse>(json_str) {
            Ok(p) => p,
            Err(e) => {
                if attempt == 0 {
                    last_error = Some(format!(
                        "Invalid JSON response: {e}. Return ONLY a valid JSON object with \"reasoning\", \"sparql\", and \"explanation\" fields."
                    ));
                    // Add the assistant's bad response to context
                    messages.push(Message {
                        role: "assistant".to_string(),
                        content: raw,
                    });
                    continue;
                }
                let answer = "I wasn't able to understand the data well enough to generate a query. Could you rephrase your question?".to_string();
                state.db.add_message(&conversation_id, "assistant", &answer, None, None, Some(AskResultCode::ParseFailed.as_str())).await;
                return data_response(AskResponse {
                    answer,
                    sparql: None,
                    data: None,
                    conversation_id: Some(conversation_id),
                    code: AskResultCode::ParseFailed,
                    reasoning: None,
                }).into_response();
            }
        };

        let sparql = format_sparql(&llm_resp.sparql);

        match dataset.sparql_select(&sparql) {
            Ok(result) => {
                debug!("SPARQL OK ({} rows)\n--- Generated SPARQL ---\n{sparql}\n--- End SPARQL ---", result.rows.len());
                validated_data = Some(result);
                parsed = Some(LlmResponse {
                    reasoning: llm_resp.reasoning,
                    sparql,
                    explanation: llm_resp.explanation,
                });
                break;
            }
            Err(err) => {
                if attempt == 0 {
                    warn!("SPARQL execution failed (attempt 1): {err}\n--- Generated SPARQL ---\n{sparql}\n--- End SPARQL ---");
                    // Add the assistant's response and error feedback
                    messages.push(Message {
                        role: "assistant".to_string(),
                        content: raw,
                    });
                    last_error = Some(format!(
                        "The SPARQL query failed with error: {err}. Please fix the query and try again."
                    ));
                    continue;
                }
                warn!("SPARQL execution failed (attempt 2): {err}\n--- Generated SPARQL ---\n{sparql}\n--- End SPARQL ---");
                let answer = "I generated a query but it didn't work against your data. Try rephrasing your question.".to_string();
                state.db.add_message(&conversation_id, "assistant", &answer, Some(&sparql), None, Some(AskResultCode::SparqlFailed.as_str())).await;
                return data_response(AskResponse {
                    answer,
                    sparql: Some(sparql),
                    data: None,
                    conversation_id: Some(conversation_id),
                    code: AskResultCode::SparqlFailed,
                    reasoning: Some(llm_resp.reasoning),
                }).into_response();
            }
        }
    }

    let parsed = match parsed {
        Some(p) => p,
        None => {
            let answer = "I wasn't able to generate a working query. Could you rephrase your question?".to_string();
            state.db.add_message(&conversation_id, "assistant", &answer, None, None, Some(AskResultCode::ParseFailed.as_str())).await;
            return data_response(AskResponse {
                answer,
                sparql: None,
                data: None,
                conversation_id: Some(conversation_id),
                code: AskResultCode::ParseFailed,
                reasoning: None,
            }).into_response();
        }
    };

    // Use the result from the validation loop (already executed successfully)
    let data = validated_data;
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
                    parsed.explanation.clone()
                }
            }
        }
    } else {
        "No data matched your query. Try rephrasing your question.".to_string()
    };

    state.db.add_message(&conversation_id, "assistant", &answer, Some(&parsed.sparql), data.as_ref(), Some(AskResultCode::Success.as_str())).await;

    data_response(AskResponse {
        answer,
        sparql: Some(parsed.sparql),
        data,
        conversation_id: Some(conversation_id),
        code: AskResultCode::Success,
        reasoning: if parsed.reasoning.is_empty() { None } else { Some(parsed.reasoning) },
    }).into_response()
}

/// Build LLM message history from conversation messages.
/// Condenses assistant messages to keep context manageable.
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
                // Condense assistant messages
                let mut condensed = String::new();
                let answer_preview: String = msg.content.chars().take(200).collect();
                let _ = write!(condensed, "[Answer: {answer_preview}]");
                if let Some(sparql) = &msg.sparql {
                    let sparql_preview: String = sparql.chars().take(200).collect();
                    let _ = write!(condensed, " [SPARQL: {sparql_preview}]");
                }
                if let Some(data) = &msg.data {
                    let _ = write!(condensed, " [Rows: {}]", data.rows.len());
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
    let conv = state.db.create_conversation(&ctx.as_ctx(), &job_id, req.title).await;
    (StatusCode::CREATED, data_response(conv)).into_response()
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
    state.db.rename_conversation(&conversation_id, ctx.org_id.as_str(), req.title.trim()).await;
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
    pub data: Option<crate::graph::types::TabularData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    pub code: AskResultCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

pub fn strip_markdown_fences(raw: &str) -> &str {
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
    let mut out = result.trim().to_string();

    // Auto-inject common PREFIX declarations when used but not declared
    const PREFIXES: &[(&str, &str)] = &[
        ("xsd:", "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>"),
        ("schema:", "PREFIX schema: <https://schema.org/>"),
        ("rdf:", "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>"),
        ("rdfs:", "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>"),
        ("dcat:", "PREFIX dcat: <http://www.w3.org/ns/dcat#>"),
        ("dct:", "PREFIX dct: <http://purl.org/dc/terms/>"),
        ("foaf:", "PREFIX foaf: <http://xmlns.com/foaf/0.1/>"),
    ];
    for (short, decl) in PREFIXES {
        if out.contains(short) && !out.contains(decl) {
            out.insert_str(0, &format!("{decl}\n"));
        }
    }

    out
}

fn summarize_results_for_llm(data: &crate::graph::types::TabularData) -> String {
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
