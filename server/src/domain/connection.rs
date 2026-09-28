//! Connections: where or what a credential is used for — a storage location
//! or a model. None of these types can hold a secret.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{Purpose, ValidationReport};

#[derive(
    Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema, strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ConnectionKind {
    /// Tables a program reads.
    #[default]
    Data,
    /// Shapes and vocabularies the editor offers.
    Vocab,
}

/// A source is read through `@name/…`; the one sink is where job output lands.
#[derive(
    Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema, strum::AsRefStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Direction {
    #[default]
    Source,
    Sink,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StorageTarget {
    /// The prefix the connection is: `s3://bucket/prefix/` or `az://container/prefix/`.
    #[schema(format = "uri")]
    pub url: String,
    #[serde(default)]
    pub kind: ConnectionKind,
    #[serde(default)]
    pub direction: Direction,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ModelTarget {
    /// The provider's model id. Empty runs the provider's default
    /// (Anthropic: claude-sonnet-4-20250514, OpenAI: gpt-4o).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The most tokens an answer may take, unless the call asks for fewer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionTarget {
    Storage(StorageTarget),
    Model(ModelTarget),
}

impl ConnectionTarget {
    pub fn purpose(&self) -> Purpose {
        match self {
            Self::Storage(_) => Purpose::Storage,
            Self::Model(_) => Purpose::Model,
        }
    }

    pub fn storage(&self) -> Option<&StorageTarget> {
        match self {
            Self::Storage(s) => Some(s),
            Self::Model(_) => None,
        }
    }

    pub fn is_sink(&self) -> bool {
        self.storage()
            .is_some_and(|s| s.direction == Direction::Sink)
    }
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ConnectionView {
    pub name: String,
    pub credential: String,
    pub target: ConnectionTarget,
    pub created_by: String,
    pub created_at: String,
    pub updated_by: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidationReport>,
}
