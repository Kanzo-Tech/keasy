//! Connections: where a secret is used — a storage location. None of these
//! types can hold a secret.

use crate::authentication::permission::{Can, Kind, Securable};
use crate::authentication::role::Caller;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{Actor, Grant, Provenance, ValidationReport};

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
    /// Who owns it: its creator, or the workspace for what the instance
    /// declares. Its owner, its managers or an admin manages it; the sink is
    /// an admin's.
    pub owner: Actor,
    /// Who else manages it. Never any on the sink.
    pub grants: Vec<Grant>,
    #[serde(flatten)]
    pub provenance: Provenance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<ValidationReport>,
    /// What the caller may do to it: test it (any editor; the sink, an admin),
    /// manage it (its owner, a manager or an admin; the sink, an admin) and
    /// give it away (its owner or an admin; the sink, no one).
    pub can: Can,
}

impl Securable for ConnectionView {
    fn kind(&self) -> Kind {
        if self.target.is_sink() {
            Kind::Sink
        } else {
            Kind::Source
        }
    }

    fn owner(&self) -> &Actor {
        &self.owner
    }

    fn grants(&self) -> &[Grant] {
        &self.grants
    }
}

impl ConnectionView {
    /// The connection as `caller` sees it: [`Self::can`] filled in.
    pub fn seen_by(mut self, caller: &Caller) -> Self {
        self.can = caller.can(&self);
        self
    }
}
