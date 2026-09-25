use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(
    Debug,
    Clone,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ConnectionKind {
    Data,
    Vocab,
}

/// Whether a connection is a READ source (programs reference it via `@conn`) or
/// the workspace's WRITE sink (where the owner's job output is materialised).
/// Orthogonal to [`ConnectionKind`] (which describes a source's data) and
/// [`LocationType`]: a connection is a named, credentialed storage location, and
/// `direction` says how it is used. Exactly one `sink` exists per workspace (the
/// owner output store); `kind` is source-only and ignored for a sink.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    Default,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Direction {
    #[default]
    Source,
    Sink,
}

#[derive(
    Debug,
    Clone,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum LocationType {
    Cloud,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub kind: ConnectionKind,
    pub location_type: LocationType,
    /// Read source vs the workspace write sink. Defaults to `source`.
    #[serde(default)]
    pub direction: Direction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_account_id: Option<String>,
    pub url: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateConnectionRequest {
    pub name: String,
    pub kind: ConnectionKind,
    pub location_type: LocationType,
    /// `source` (default) or `sink` (the owner output store; one per workspace).
    #[serde(default)]
    pub direction: Direction,
    pub cloud_account_id: Option<String>,
    pub url: String,
}

impl CreateConnectionRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("name is required".into());
        }
        if self.url.trim().is_empty() {
            return Err("url is required".into());
        }
        if self.location_type == LocationType::Cloud && self.cloud_account_id.is_none() {
            return Err("cloud_account_id is required for cloud connections".into());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListConnectionsQuery {
    /// Only connections of this kind.
    #[serde(rename = "type")]
    pub kind: Option<ConnectionKind>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ConnectionRefsResponse {
    /// Source connection name → base URL, the map `@name/…` expands against.
    pub refs: HashMap<String, String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SignLocatorsRequest {
    /// Locators fossil expanded from `@name/path` (`s3://bucket/prefix/users.csv`).
    pub locators: Vec<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SignLocatorsResponse {
    /// Locator → fetchable URL. A locator keasy will not sign is absent.
    pub urls: HashMap<String, String>,
}
