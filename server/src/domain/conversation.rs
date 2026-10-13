use serde::Serialize;

use super::{Actor, Provenance};
use crate::authentication::permission::{Kind, Securable};

/// The assistant's conversation, as the web stored it: its messages, opaque to
/// keasy — the web strips every row of anyone's data out of them before they
/// are sent (`web/src/lib/assistant-conversation.ts`, `toStored`), and keasy
/// stores the array and hands it back, never reading an element of it.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct Conversation {
    pub id: String,
    /// The messages, in order, as the web serialises them (AI SDK
    /// `UIMessage`s, stripped).
    #[schema(value_type = Vec<Value>)]
    pub messages: Vec<serde_json::Value>,
    /// Whether a graph was built from it: then it is that graph's record, and
    /// a save is refused (`conversation/built`) — the web saves a copy instead.
    pub built: bool,
    /// Who owns it, and saves it: its creator, to begin with.
    pub owner: Actor,
    /// Who created it and when, and who saved it last.
    #[serde(flatten)]
    pub provenance: Provenance,
}

impl Securable for Conversation {
    fn kind(&self) -> Kind {
        Kind::Conversation
    }

    fn owner(&self) -> &Actor {
        &self.owner
    }
}
