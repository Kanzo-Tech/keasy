//! Who made a resource and who changed it last, as each one was named when they
//! did it: the display name is taken from the token at write time and kept, so
//! a list never asks the identity provider who a `sub` is.

use serde::Serialize;
use utoipa::ToSchema;

/// Someone who wrote a resource.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Actor {
    /// The Keycloak `sub`: what authorization compares.
    pub id: String,
    /// Their display name when they wrote it: for people to read, never to authorize on.
    pub name: String,
}

impl Actor {
    /// Who wrote what an instance declares at boot: nobody who signs in, so
    /// only an admin may change it.
    pub fn bootstrap() -> Self {
        Self {
            id: "bootstrap".into(),
            name: "Bootstrap".into(),
        }
    }
}

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
