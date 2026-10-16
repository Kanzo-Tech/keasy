//! The assistant's conversations: read, and saved whole after each reply under
//! the id the client made — the AI SDK's chat persistence, `UIMessage[]` per
//! chat id. keasy
//! stores the messages opaque: what they may hold, and what they never do, is
//! the web's `toStored` (docs/design/assistant.md, *the conversation is kept*).

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Deserialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::permission::Action;
use crate::authentication::role::{Editor, Reader};
use crate::conversations;
use crate::domain::Conversation;
use crate::error::{Problem, Refusal, ServerCode};
use crate::startup::AppState;

/// The most a conversation's messages may weigh, as stored JSON: the turns, the
/// options offered and taken, the questions and the program — structure, never
/// data.
pub const MAX_MESSAGES_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SaveMessagesRequest {
    /// Every message of the conversation, in order: a JSON array, stored as sent.
    #[schema(value_type = Vec<Value>)]
    pub messages: serde_json::Value,
}

/// `messages`, if it is an array no heavier than the cap.
fn messages(messages: serde_json::Value) -> Result<Vec<serde_json::Value>, Refusal> {
    let serde_json::Value::Array(messages) = messages else {
        return Err(Refusal::invalid_field(
            "messages",
            "A conversation's messages are a JSON array",
        ));
    };
    let size = serde_json::to_vec(&messages)
        .map(|v| v.len())
        .unwrap_or(usize::MAX);
    if size > MAX_MESSAGES_BYTES {
        return Err(Refusal::new(
            ServerCode::RequestTooLarge,
            format!(
                "A conversation's messages are at most {MAX_MESSAGES_BYTES} bytes; these are {size}"
            ),
        ));
    }
    Ok(messages)
}

/// The conversation, whoever started it: everyone who reads the graph built
/// from it reads what was decided.
pub fn any(conn: &rusqlite::Connection, id: &str) -> Result<Conversation, Refusal> {
    conversations::get(conn, id)?
        .ok_or_else(|| Refusal::new(ServerCode::ConversationNotFound, "No such conversation"))
}

#[utoipa::path(get, path = "/v1/conversations/{id}", tag = "Conversations", security(("bearer" = ["reader"])),
    params(("id" = String, Path, description = "Conversation ID")),
    responses(
        (status = 200, description = "The conversation, its messages as they were last saved", body = Conversation),
        (status = 404, description = "Conversation not found", body = Problem, content_type = "application/problem+json"),
    )
)]
pub async fn get_conversation(
    caller: Reader,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Conversation>, Refusal> {
    let conversation = any(&*state.db.read().await, &id)?;
    caller.ensure(Action::Read, &conversation)?;
    Ok(Json(conversation))
}

#[utoipa::path(put, path = "/v1/conversations/{id}", tag = "Conversations", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Conversation ID: a UUID the client makes, as the AI SDK's chat ids are")),
    request_body = SaveMessagesRequest,
    responses(
        (status = 200, description = "The messages, replaced whole", body = Conversation),
        (status = 201, description = "The conversation, started with these messages", body = Conversation),
        (status = 400, description = "The id is not a UUID, or the messages are not a JSON array (`data.field`)", body = Problem, content_type = "application/problem+json"),
        (status = 403, description = "Neither its owner nor an admin (`rbac/forbidden`)", body = Problem, content_type = "application/problem+json"),
        (status = 409, description = "A graph was built from it (`conversation/built`): carry on in another id", body = Problem, content_type = "application/problem+json"),
        (status = 413, description = "The messages are heavier than a conversation may be", body = Problem, content_type = "application/problem+json"),
    )
)]
/// Save the conversation `id` after a reply: every message, replacing what was
/// stored, or starting it when nothing is — the AI SDK's chat persistence, a
/// chat's id the client's own. Whole, not appended: an earlier answer taken
/// again replaces the turns after it, and a save sent twice is one save.
pub async fn save_conversation(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<SaveMessagesRequest>,
) -> Result<impl IntoResponse, Refusal> {
    if uuid::Uuid::parse_str(&id).is_err() {
        return Err(Refusal::invalid_field(
            "id",
            "A conversation's id is a UUID",
        ));
    }
    let messages = messages(payload.messages)?;
    let existing = conversations::get(&*state.db.read().await, &id)?;
    if let Some(existing) = &existing {
        caller.ensure(Action::Manage, existing)?;
    }
    let status = if existing.is_some() {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    if let Some(saved) =
        conversations::save(&*state.db.write().await, &id, &messages, &caller.actor())?
    {
        return Ok((status, Json(saved)));
    }
    Err(Refusal::new(
        ServerCode::ConversationBuilt,
        "A graph was built from this conversation; carry on in another",
    ))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(get_conversation))
        .routes(routes!(save_conversation))
}
