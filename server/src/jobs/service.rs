use std::sync::Arc;

use crate::error::AppError;
use crate::tenant::{Tenant, TenantResource};

use super::models::{CreateJobRequest, Job, JobStatus, RunMode, UpdateJobRequest, now_iso8601};
use super::repository::JobRepository;

pub struct JobService {
    repo: Arc<dyn JobRepository>,
}

impl JobService {
    pub fn new(repo: Arc<dyn JobRepository>) -> Self {
        Self { repo }
    }

    pub async fn list(&self, tenant: &Tenant) -> Vec<Job> {
        self.repo.list(tenant).await
    }

    pub async fn get(&self, resource: &TenantResource<'_>) -> Result<Job, AppError> {
        self.repo.get(resource).await.ok_or(AppError::NotFound)
    }

    pub async fn create_draft(
        &self,
        tenant: &Tenant,
        payload: CreateJobRequest,
    ) -> Result<Job, AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        let job = Job {
            id: id.clone(),
            status: JobStatus::Draft,
            name: payload.name.or_else(|| Some(id[..8].to_string())),
            created_at: now_iso8601(),
            started_at: None,
            completed_at: None,
            error: None,
            mode: payload.mode.unwrap_or(RunMode::Integrated),
            pipeline: payload.pipeline.unwrap_or_default(),
            dcat_input: None,
            connector_ids: payload.connector_ids,
            script: Some(payload.script),
            rdf_base: None,
            manifest: None,
        };
        self.repo
            .insert(tenant, &job)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?;
        Ok(job)
    }

    pub async fn create_and_submit(
        &self,
        tenant: &Tenant,
        payload: &CreateJobRequest,
    ) -> Result<Job, AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        let job = Job {
            id: id.clone(),
            status: JobStatus::Pending,
            name: payload.name.clone().or_else(|| Some(id[..8].to_string())),
            created_at: now_iso8601(),
            started_at: None,
            completed_at: None,
            error: None,
            mode: payload.mode.clone().unwrap_or(RunMode::Integrated),
            pipeline: payload.pipeline.clone().unwrap_or_default(),
            dcat_input: None,
            connector_ids: payload.connector_ids.clone(),
            script: None,
            rdf_base: None,
            manifest: None,
        };
        self.repo
            .insert(tenant, &job)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?;
        Ok(job)
    }

    pub async fn update(
        &self,
        resource: &TenantResource<'_>,
        payload: UpdateJobRequest,
    ) -> Result<Job, AppError> {
        let result = self
            .repo
            .update(
                resource,
                Box::new(move |job| {
                    if job.status != JobStatus::Draft {
                        return;
                    }
                    if let Some(script) = payload.script {
                        job.script = Some(script);
                    }
                    if let Some(name) = payload.name {
                        job.name = Some(name);
                    }
                }),
            )
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?;

        match result {
            Some(job) if job.status == JobStatus::Draft => Ok(job),
            Some(_) => Err(AppError::Conflict("only draft jobs can be updated".into())),
            None => Err(AppError::NotFound),
        }
    }

    pub async fn delete(&self, resource: &TenantResource<'_>) -> Result<(), AppError> {
        let job = self.repo.get(resource).await.ok_or(AppError::NotFound)?;

        if matches!(job.status, JobStatus::Pending | JobStatus::Running) {
            return Err(AppError::Conflict("cannot delete a running job".into()));
        }

        self.repo
            .delete(resource)
            .await
            .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?;
        Ok(())
    }
}
