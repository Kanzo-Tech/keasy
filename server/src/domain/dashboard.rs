use serde::Serialize;

use super::Provenance;

/// A job's saved dashboard. `spec` is the dashboard the web's BI kit
/// serialises (`DashboardSpec`): keasy stores it and hands it back, and never
/// reads a field of it.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct Dashboard {
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    pub spec: serde_json::Map<String, serde_json::Value>,
    /// Who saved it first and when, and who saved it last.
    #[serde(flatten)]
    pub provenance: Provenance,
}
