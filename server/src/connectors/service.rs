use std::sync::Arc;

use futures::StreamExt;

use crate::error::AppError;
use crate::tenant::{Tenant, TenantResource};

use super::config::ConnectorConfig;
use super::models::{ConnectorResponse, CreateConnectorRequest, UpdateConnectorRequest};
use super::repository::ConnectorRepository;

pub struct ConnectorService {
    repo: Arc<dyn ConnectorRepository>,
}

impl ConnectorService {
    pub fn new(repo: Arc<dyn ConnectorRepository>) -> Self {
        Self { repo }
    }

    pub async fn create(
        &self,
        tenant: &Tenant,
        req: CreateConnectorRequest,
    ) -> Result<ConnectorResponse, AppError> {
        req.validate().map_err(AppError::Validation)?;
        test_connection(&req.config).await?;
        let connector = self
            .repo
            .create(tenant, req)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
        Ok(ConnectorResponse::from(connector))
    }

    pub async fn get(&self, resource: &TenantResource<'_>) -> Result<ConnectorResponse, AppError> {
        self.repo
            .get(resource)
            .await
            .map(ConnectorResponse::from)
            .ok_or(AppError::NotFound)
    }

    pub async fn list(
        &self,
        tenant: &Tenant,
        direction: Option<&str>,
    ) -> Vec<ConnectorResponse> {
        self.repo
            .list(tenant, direction)
            .await
            .into_iter()
            .map(ConnectorResponse::from)
            .collect()
    }

    pub async fn update(
        &self,
        resource: &TenantResource<'_>,
        req: UpdateConnectorRequest,
    ) -> Result<ConnectorResponse, AppError> {
        if let Some(ref config) = req.config {
            config.validate().map_err(AppError::Validation)?;
            test_connection(config).await?;
        }
        let connector = self
            .repo
            .update(resource, req)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?
            .ok_or(AppError::NotFound)?;
        Ok(ConnectorResponse::from(connector))
    }

    pub async fn delete(&self, resource: &TenantResource<'_>) -> Result<(), AppError> {
        if self.repo.delete(resource).await {
            Ok(())
        } else {
            Err(AppError::NotFound)
        }
    }

    pub async fn test(&self, resource: &TenantResource<'_>) -> Result<(), AppError> {
        let connector = self
            .repo
            .get_with_secrets(resource)
            .await
            .ok_or(AppError::NotFound)?;
        let cc = serde_json::from_value::<ConnectorConfig>(connector.config)
            .map_err(|e| AppError::Validation(e.to_string()))?;
        test_connection(&cc).await
    }

    /// Dry-run a config provided directly in the request body. Used by the
    /// "Test connection" button in the New Connection form before saving.
    pub async fn test_config(&self, config: &ConnectorConfig) -> Result<(), AppError> {
        config.validate().map_err(AppError::Validation)?;
        test_connection(config).await
    }
}

async fn test_connection(config: &ConnectorConfig) -> Result<(), AppError> {
    let (store, prefix) = config
        .build_store()
        .map_err(|msg| AppError::Validation(format!("connection test: {msg}")))?;
    let list_prefix = if prefix.as_ref().is_empty() {
        None
    } else {
        Some(&prefix)
    };
    let mut stream = store.list(list_prefix);
    match stream.next().await {
        Some(Ok(_)) | None => Ok(()),
        Some(Err(e)) => Err(AppError::Validation(format!("connection test: {e}"))),
    }
}
