//! Connections: where a credential is used — a storage location. None of these
//! types can hold a secret.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::ValidationReport;

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

impl StorageTarget {
    pub fn is_sink(&self) -> bool {
        self.direction == Direction::Sink
    }
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ConnectionView {
    pub name: String,
    pub credential: String,
    pub target: StorageTarget,
    pub created_by: String,
    pub created_at: String,
    pub updated_by: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidationReport>,
}
