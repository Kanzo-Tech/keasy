use async_trait::async_trait;

use crate::tenant::{Tenant, TenantResource};

use super::models::Job;

/// Boxed callback for read-modify-write updates.
pub type JobUpdateFn = Box<dyn FnOnce(&mut Job) + Send + 'static>;

#[async_trait]
pub trait JobRepository: Send + Sync {
    async fn insert(&self, tenant: &Tenant, job: &Job) -> Result<(), String>;
    async fn get(&self, resource: &TenantResource<'_>) -> Option<Job>;
    async fn list(&self, tenant: &Tenant) -> Vec<Job>;
    async fn update(
        &self,
        resource: &TenantResource<'_>,
        f: JobUpdateFn,
    ) -> Result<Option<Job>, String>;
    async fn delete(&self, resource: &TenantResource<'_>) -> Result<(), String>;
}
