use object_store::local::LocalFileSystem;
use object_store::path::Path as ObjectPath;
use super::{str_field, CloudStore, ConnectorDirection, ConnectorType, ConnectorTypeInfo};

pub struct LocalFsConnector;

impl ConnectorType for LocalFsConnector {
    fn info(&self) -> ConnectorTypeInfo {
        ConnectorTypeInfo {
            id: "local_fs",
            name: "Local Filesystem",
            description: "Local directory",
            direction: ConnectorDirection::Both,
            secret_fields: &[],
        }
    }

    fn validate(&self, config: &serde_json::Value) -> Result<(), String> {
        str_field(config, "base_path").ok_or_else(|| "base_path is required".to_string())?;
        Ok(())
    }

    fn base_url(&self, config: &serde_json::Value) -> String {
        str_field(config, "base_path").unwrap_or("").to_string()
    }

    fn build_store(
        &self,
        config: &serde_json::Value,
    ) -> Result<(CloudStore, ObjectPath), String> {
        let base = self.base_url(config);
        let store = LocalFileSystem::new_with_prefix(&base)
            .map_err(|e| format!("failed to create local store: {e}"))?;
        Ok((CloudStore::Local(store), ObjectPath::from("")))
    }
}
