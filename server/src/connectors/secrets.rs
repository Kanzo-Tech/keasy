use std::collections::HashMap;

use serde_json::Value;

use crate::db::Repos;

use super::models::Connector;

pub fn field_names_for_kind(kind: &str) -> &'static [&'static str] {
    match kind {
        "s3" => &["secret_access_key", "session_token"],
        "gcs" => &["service_account_json", "hmac_secret"],
        "azure_blob" => &["connection_string"],
        _ => &[],
    }
}

pub fn split(connector_type: &str, config: &Value) -> (Value, HashMap<String, String>) {
    let secret_names = field_names_for_kind(connector_type);
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

pub fn merge(config: &Value, secrets: &HashMap<String, String>) -> Value {
    let mut merged = config.clone();
    if let Some(obj) = merged.as_object_mut() {
        for (k, v) in secrets {
            obj.insert(k.clone(), Value::String(v.clone()));
        }
    }
    merged
}

pub fn redact(connector_type: &str, config: &Value) -> Value {
    let secret_names = field_names_for_kind(connector_type);
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

pub fn key_for(connector_id: &str) -> String {
    format!("connector:{connector_id}")
}

pub async fn merge_from_db(db: &Repos, connector: &mut Connector) {
    if let Some(bytes) = db.get_secret(&key_for(&connector.id)).await {
        if let Ok(secrets) = serde_json::from_slice::<HashMap<String, String>>(&bytes) {
            connector.config = merge(&connector.config, &secrets);
        }
    }
}
