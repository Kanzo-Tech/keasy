use futures::StreamExt;

use super::error::ConnectorError;
use super::types::ConnectorConfig;

pub async fn test_connection(config: &ConnectorConfig) -> Result<(), ConnectorError> {
    let (store, prefix) = config
        .build_store()
        .map_err(ConnectorError::TestFailed)?;
    let list_prefix = if prefix.as_ref().is_empty() {
        None
    } else {
        Some(&prefix)
    };
    let mut stream = store.list(list_prefix);
    match stream.next().await {
        Some(Ok(_)) | None => Ok(()),
        Some(Err(e)) => Err(ConnectorError::TestFailed(e.to_string())),
    }
}
