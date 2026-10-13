//! The assistant's conversations: started, read, and saved whole after each
//! reply — the AI SDK's chat persistence, `UIMessage[]` per chat id. keasy
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
use crate::error::{ErrorBody, ErrorCode, Refusal};
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
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::RequestTooLarge,
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
        .ok_or_else(|| Refusal::not_found(ErrorCode::ConversationNotFound, "No such conversation"))
}

#[utoipa::path(post, path = "/v1/conversations", tag = "Conversations", security(("bearer" = ["editor"])),
    request_body = SaveMessagesRequest,
    responses(
        (status = 201, description = "The conversation, started with these messages", body = Conversation),
        (status = 400, description = "The messages are not a JSON array (`data.field`)", body = ErrorBody),
        (status = 413, description = "The messages are heavier than a conversation may be", body = ErrorBody),
    )
)]
/// Start a conversation: with no message yet, or with another's, to continue
/// what a built graph decided without changing its record.
pub async fn create_conversation(
    caller: Editor,
    State(state): State<AppState>,
    Json(payload): Json<SaveMessagesRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let messages = messages(payload.messages)?;
    let conversation = conversations::insert(&*state.db.write().await, &messages, &caller.actor())?;
    Ok((StatusCode::CREATED, Json(conversation)))
}

#[utoipa::path(get, path = "/v1/conversations/{id}", tag = "Conversations", security(("bearer" = ["reader"])),
    params(("id" = String, Path, description = "Conversation ID")),
    responses(
        (status = 200, description = "The conversation, its messages as they were last saved", body = Conversation),
        (status = 404, description = "Conversation not found", body = ErrorBody),
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

#[utoipa::path(put, path = "/v1/conversations/{id}/messages", tag = "Conversations", security(("bearer" = ["editor"])),
    params(("id" = String, Path, description = "Conversation ID")),
    request_body = SaveMessagesRequest,
    responses(
        (status = 200, description = "The messages, replaced whole", body = Conversation),
        (status = 400, description = "The messages are not a JSON array (`data.field`)", body = ErrorBody),
        (status = 403, description = "Neither its owner nor an admin (`rbac/forbidden`)", body = ErrorBody),
        (status = 404, description = "Conversation not found", body = ErrorBody),
        (status = 409, description = "A graph was built from it (`conversation/built`): start one from its messages instead", body = ErrorBody),
        (status = 413, description = "The messages are heavier than a conversation may be", body = ErrorBody),
    )
)]
/// Save the conversation after a reply: every message, replacing what was
/// stored. Whole, not appended — an earlier answer taken again replaces the
/// turns after it, and a save sent twice is one save.
pub async fn save_messages(
    caller: Editor,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<SaveMessagesRequest>,
) -> Result<Json<Conversation>, Refusal> {
    let messages = messages(payload.messages)?;
    caller.ensure(Action::Manage, &any(&*state.db.read().await, &id)?)?;
    if let Some(saved) =
        conversations::replace(&*state.db.write().await, &id, &messages, &caller.actor())?
    {
        return Ok(Json(saved));
    }
    any(&*state.db.read().await, &id)?;
    Err(Refusal::conflict(
        ErrorCode::ConversationBuilt,
        "A graph was built from this conversation; start another from its messages",
    ))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(create_conversation))
        .routes(routes!(get_conversation))
        .routes(routes!(save_messages))
}
