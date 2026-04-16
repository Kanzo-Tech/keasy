use async_trait::async_trait;

use crate::tenant::{Tenant, TenantResource};

use super::models::{Connector, CreateConnectorRequest, UpdateConnectorRequest};

#[async_trait]
pub trait ConnectorRepository: Send + Sync {
    async fn create(&self, tenant: &Tenant, req: CreateConnectorRequest) -> Result<Connector, String>;
    async fn get(&self, resource: &TenantResource<'_>) -> Option<Connector>;
    async fn get_with_secrets(&self, resource: &TenantResource<'_>) -> Option<Connector>;
    async fn list(&self, tenant: &Tenant, direction: Option<&str>) -> Vec<Connector>;
    async fn update(&self, resource: &TenantResource<'_>, req: UpdateConnectorRequest) -> Result<Option<Connector>, String>;
    async fn delete(&self, resource: &TenantResource<'_>) -> bool;
}
