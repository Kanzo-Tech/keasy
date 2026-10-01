use serde::Serialize;

/// A job's saved dashboard. `spec` is the dashboard the web's BI kit
/// serialises (`DashboardSpec`): keasy stores it and hands it back, and never
/// reads a field of it.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct Dashboard {
    #[schema(value_type = Object)]
    pub spec: serde_json::Map<String, serde_json::Value>,
    pub updated_at: String,
    /// Keycloak `sub` of the member who saved it last.
    pub updated_by: String,
}
