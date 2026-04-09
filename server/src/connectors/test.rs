use futures::StreamExt;

use super::error::ConnectorError;
use super::types::ConnectorType;

/// Test connectivity by building the store and listing under the configured prefix.
/// Uses the prefix from build_store so we don't scan an entire bucket root.
pub async fn test_connection(
    ct: &dyn ConnectorType,
    config: &serde_json::Value,
) -> Result<(), ConnectorError> {
    let (store, prefix) = ct
        .build_store(config)
        .map_err(|e| ConnectorError::TestFailed(e))?;
    let list_prefix = if prefix.as_ref().is_empty() { None } else { Some(&prefix) };
    let mut stream = store.list(list_prefix);
    match stream.next().await {
        Some(Ok(_)) | None => Ok(()),
        Some(Err(e)) => Err(ConnectorError::TestFailed(e.to_string())),
    }
}
