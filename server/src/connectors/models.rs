use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::db::diesel_schema::connectors;

use super::types::ConnectorConfig;

// ── Direction enum (API-facing) ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorDirection {
    Source,
    Destination,
    Both,
}

impl ConnectorDirection {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Destination => "destination",
            Self::Both => "both",
        }
    }

    pub fn from_db(s: &str) -> Self {
        match s {
            "destination" => Self::Destination,
            "both" => Self::Both,
            _ => Self::Source,
        }
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
    pub fn into_redacted(mut self) -> Self {
        let config_val = std::mem::take(&mut self.config);
        match serde_json::from_value::<ConnectorConfig>(config_val) {
            Ok(cc) => {
                if let Ok(v) = serde_json::to_value(&cc.into_redacted()) {
                    self.config = v;
                }
            }
            Err(e) => {
                tracing::warn!(id = %self.id, error = %e, "failed to parse config for redaction, stripping entirely");
                self.config = serde_json::json!({});
            }
        }
        self
    }

    pub fn parse_config(&self) -> Result<ConnectorConfig, String> {
        serde_json::from_value(self.config.clone())
            .map_err(|e| format!("invalid connector config: {e}"))
    }

    pub fn into_config(self) -> Result<ConnectorConfig, String> {
        serde_json::from_value(self.config)
            .map_err(|e| format!("invalid connector config: {e}"))
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
    pub config: Option<serde_json::Value>,
}
