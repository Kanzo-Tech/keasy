//! Who made a resource and who changed it last, as each one was named when they
//! did it: the display name is taken from the token at write time and kept, so
//! a list never asks the identity provider who a `sub` is.
//!
//! Who created a resource never changes; who owns it is another column
//! (`owner`), which starts as its creator — or [`Actor::workspace`] for what
//! the instance declares — and is what permissions read.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Someone who wrote a resource, or owns one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Actor {
    /// The Keycloak `sub`: what authorization compares.
    pub id: String,
    /// Their display name when they wrote it: for people to read, never to authorize on.
    pub name: String,
}

impl Actor {
    /// Who wrote what an instance declares at boot: nobody who signs in.
    pub fn bootstrap() -> Self {
        Self {
            id: "bootstrap".into(),
            name: "Bootstrap".into(),
        }
    }

    /// The workspace itself, as an owner: of what the instance declares, and —
    /// later — of what someone who left made. Every editor uses and operates
    /// what it owns; only an admin manages it.
    pub fn workspace() -> Self {
        Self {
            id: WORKSPACE.into(),
            name: "Workspace".into(),
        }
    }

    pub fn is_workspace(&self) -> bool {
        self.id == WORKSPACE
    }

    /// Who owns what this actor creates: they do, unless they are the
    /// bootstrap, whose declarations are the workspace's.
    pub fn as_owner(&self) -> Self {
        if self.id == Self::bootstrap().id {
            Self::workspace()
        } else {
            self.clone()
        }
    }
}

/// The `owner` of what the workspace owns. Keycloak `sub`s are UUIDs, so it is
/// never a person's.
pub const WORKSPACE: &str = "workspace";

/// Who created a resource and when, and who changed it last and when — absent
/// until someone has.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct Provenance {
    pub created_by: Actor,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<Actor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

impl Provenance {
    /// Created by `by` now, and not changed since.
    pub fn created(by: Actor) -> Self {
        Self {
            created_by: by,
            created_at: super::now_iso8601(),
            updated_by: None,
            updated_at: None,
        }
    }
}
