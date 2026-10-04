//! Connections: where a secret is used — a storage location. None of these
//! types can hold a secret.

use crate::authentication::role::{Caller, Role};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{Provenance, ValidationReport};

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

/// A source is read through `@name/…`; the one sink is where graph output lands.
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
    pub secret: String,
    pub target: StorageTarget,
    #[serde(flatten)]
    pub provenance: Provenance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidationReport>,
    /// Whether the caller may change or delete it: the sink is an admin's,
    /// any other connection its creator's or an admin's.
    #[serde(default)]
    pub can_modify: bool,
}

impl ConnectionView {
    /// Who may change a connection: an admin the sink, and an admin or its
    /// creator any other.
    pub fn may_be_changed_by(&self, caller: &Caller) -> bool {
        if self.target.is_sink() {
            caller.holds(Role::Admin)
        } else {
            caller.may_modify(&self.provenance.created_by.id)
        }
    }

    /// The connection as `caller` sees it: [`Self::can_modify`] filled in.
    pub fn seen_by(mut self, caller: &Caller) -> Self {
        self.can_modify = self.may_be_changed_by(caller);
        self
    }
}
