use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::db::diesel_schema::connectors;

use super::config::ConnectorConfig;

// ── Direction enum (API-facing) ──────────────────────────────────────

#[derive(
    Debug,
    Clone,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    utoipa::ToSchema,
    strum::Display,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ConnectorDirection {
    Source,
    Destination,
    Both,
}

impl ConnectorDirection {
    pub fn from_db(s: &str) -> Self {
        s.parse().unwrap_or(Self::Source)
    }
}

// ── Diesel row model (what the DB returns) ───────────────────────────

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = connectors)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ConnectorRow {
    pub id: String,
    pub organization_id: String,
    pub name: String,
    pub connector_type: String,
    pub direction: String,
    pub config: String,
    pub created_at: String,
    pub updated_at: String,
}

// ── Diesel insert model ──────────────────────────────────────────────

#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = connectors)]
pub struct NewConnector {
    pub id: String,
    pub organization_id: String,
    pub name: String,
    pub connector_type: String,
    pub direction: String,
    pub config: String,
    pub created_at: String,
    pub updated_at: String,
}

// ── Diesel update changeset ──────────────────────────────────────────

#[derive(Debug, Default, AsChangeset)]
#[diesel(table_name = connectors)]
pub struct ConnectorChangeset {
    pub name: Option<String>,
    pub connector_type: Option<String>,
    pub direction: Option<String>,
    pub config: Option<String>,
    pub updated_at: Option<String>,
}

// ── API-facing model ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct Connector {
    pub id: String,
    pub name: String,
    pub connector_type: String,
    pub direction: ConnectorDirection,
    pub config: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

impl From<ConnectorRow> for Connector {
    fn from(r: ConnectorRow) -> Self {
        Self {
            id: r.id,
            name: r.name,
            connector_type: r.connector_type,
            direction: ConnectorDirection::from_db(&r.direction),
            config: serde_json::from_str(&r.config).unwrap_or_default(),
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

impl Connector {
    pub fn parse_config(&self) -> Result<ConnectorConfig, String> {
        serde_json::from_value(self.config.clone())
            .map_err(|e| format!("invalid connector config: {e}"))
    }

    pub fn into_config(self) -> Result<ConnectorConfig, String> {
        serde_json::from_value(self.config)
            .map_err(|e| format!("invalid connector config: {e}"))
    }
}

// ── API response type (always redacted) ─────────────────────────────

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ConnectorResponse {
    pub id: String,
    pub name: String,
    pub connector_type: String,
    pub direction: ConnectorDirection,
    pub config: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

impl From<Connector> for ConnectorResponse {
    fn from(c: Connector) -> Self {
        let redacted = match serde_json::from_value::<ConnectorConfig>(c.config) {
            Ok(cc) => serde_json::to_value(&cc.into_redacted()).unwrap_or_default(),
            Err(e) => {
                tracing::warn!(id = %c.id, error = %e, "failed to parse config for redaction");
                serde_json::json!({})
            }
        };
        Self {
            id: c.id,
            name: c.name,
            connector_type: c.connector_type,
            direction: c.direction,
            config: redacted,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

// ── API request types ────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateConnectorRequest {
    pub name: String,
    pub direction: ConnectorDirection,
    pub config: ConnectorConfig,
}

impl CreateConnectorRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("name is required".into());
        }
        self.config.validate()
    }
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateConnectorRequest {
    pub name: Option<String>,
    pub direction: Option<ConnectorDirection>,
    pub config: Option<ConnectorConfig>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TestConnectorRequest {
    pub config: ConnectorConfig,
}
