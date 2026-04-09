use std::collections::HashMap;

use serde_json::Value;

use crate::db::Repos;

use super::models::Connector;
use super::types::ConnectorRegistry;

/// Identify secret field names from a connector type's static metadata.
pub fn field_names(registry: &ConnectorRegistry, connector_type: &str) -> &'static [&'static str] {
    registry
        .get(connector_type)
        .map(|ct| ct.info().secret_fields)
        .unwrap_or(&[])
}

/// Split config into (public_config, secrets_map).
pub fn split(
    registry: &ConnectorRegistry,
    connector_type: &str,
    config: &Value,
) -> (Value, HashMap<String, String>) {
    let secret_names = field_names(registry, connector_type);
    let mut public = config.clone();
    let mut secrets = HashMap::new();
    if let Some(obj) = public.as_object_mut() {
        for name in secret_names {
            if let Some(val) = obj.remove(*name) {
                if let Some(s) = val.as_str() {
                    secrets.insert((*name).to_string(), s.to_string());
                }
            }
        }
    }
    (public, secrets)
}

/// Merge secrets back into config for internal use.
pub fn merge(config: &Value, secrets: &HashMap<String, String>) -> Value {
    let mut merged = config.clone();
    if let Some(obj) = merged.as_object_mut() {
        for (k, v) in secrets {
            obj.insert(k.clone(), Value::String(v.clone()));
        }
    }
    merged
}

/// Redact secret fields — replace values with boolean true (has_stored_value flag).
pub fn redact(
    registry: &ConnectorRegistry,
    connector_type: &str,
    config: &Value,
) -> Value {
    let secret_names = field_names(registry, connector_type);
    let mut redacted = config.clone();
    if let Some(obj) = redacted.as_object_mut() {
        for name in secret_names {
            if obj.contains_key(*name) {
                obj.insert((*name).to_string(), Value::Bool(true));
            }
        }
    }
    redacted
}

/// Build the secrets table key for a connector.
pub fn key_for(connector_id: &str) -> String {
    format!("connector:{connector_id}")
}

/// Merge secrets from the encrypted store into a connector's config.
pub async fn merge_from_db(db: &Repos, connector: &mut Connector) {
    if let Some(bytes) = db.get_secret(&key_for(&connector.id)).await {
        if let Ok(secrets) = serde_json::from_slice::<HashMap<String, String>>(&bytes) {
            connector.config = merge(&connector.config, &secrets);
        }
    }
}
