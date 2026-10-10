//! Grants: who, besides an object's owner, may manage it — and who may use a
//! secret. Unity Catalog's privileges (`MANAGE`, using a storage credential),
//! kept as Zanzibar's tuples — object, relation, principal — in one local
//! table (`grants`), never in the token.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::Actor;

/// Who a grant is to: a person, or one of the organization's Keycloak groups.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PrincipalKind {
    User,
    Group,
}

/// A grantee, by id — a person's `sub` or a group's Keycloak id, what
/// authorization compares — and by the name it had when it was granted, for
/// people to read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Principal {
    pub kind: PrincipalKind,
    pub id: String,
    pub name: String,
}

/// What a grant gives.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Relation {
    /// Manages the object as its owner does: edit, rename, delete, share. Not
    /// transfer: only the owner or an admin gives an object away.
    Manager,
    /// Uses a secret — builds a connection on it. Secrets only: what else
    /// can be used, every editor uses.
    User,
}

/// One grant on an object.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Grant {
    pub principal: Principal,
    pub relation: Relation,
    /// Who granted it, and when.
    pub granted_by: Actor,
    pub granted_at: String,
}
