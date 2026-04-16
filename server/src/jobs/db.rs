use async_trait::async_trait;
use diesel::prelude::*;

use crate::db::diesel_schema::jobs::dsl;
use crate::db::Repos;
use crate::tenant::{Tenant, TenantResource};

use super::models::{Job, JobChangeset, JobRow, NewJob};
use super::repository::{JobRepository, JobUpdateFn};

/// Build a NewJob from a Job + organization_id, serializing JSON fields.
fn to_new_job(job: &Job, org_id: &str) -> Result<NewJob, String> {
    Ok(NewJob {
        id: job.id.clone(),
        organization_id: org_id.to_string(),
        name: job.name.clone(),
        status: job.status.as_str().to_string(),
        mode: job.mode.as_str().to_string(),
        created_at: job.created_at.clone(),
        started_at: job.started_at.clone(),
        completed_at: job.completed_at.clone(),
        error: job.error.as_ref()
            .map(serde_json::to_string).transpose()
            .map_err(|e| format!("serialize error: {e}"))?,
        pipeline: serde_json::to_string(&job.pipeline)
            .map_err(|e| format!("serialize pipeline: {e}"))?,
        connector_ids: serde_json::to_string(&job.connector_ids)
            .map_err(|e| format!("serialize connector_ids: {e}"))?,
        script: job.script.clone(),
        rdf_base: job.rdf_base.clone(),
        manifest: job.manifest.as_ref()
            .map(serde_json::to_string).transpose()
            .map_err(|e| format!("serialize manifest: {e}"))?,
    })
}

/// Build a changeset from a Job, serializing JSON fields.
fn to_changeset(job: &Job) -> Result<JobChangeset, String> {
    Ok(JobChangeset {
        name: Some(job.name.clone()),
        status: Some(job.status.as_str().to_string()),
        started_at: Some(job.started_at.clone()),
        completed_at: Some(job.completed_at.clone()),
        error: Some(job.error.as_ref()
            .map(serde_json::to_string).transpose()
            .map_err(|e| format!("serialize error: {e}"))?),
        pipeline: Some(serde_json::to_string(&job.pipeline)
            .map_err(|e| format!("serialize pipeline: {e}"))?),
        connector_ids: Some(serde_json::to_string(&job.connector_ids)
            .map_err(|e| format!("serialize connector_ids: {e}"))?),
        script: Some(job.script.clone()),
        rdf_base: Some(job.rdf_base.clone()),
        manifest: Some(job.manifest.as_ref()
            .map(serde_json::to_string).transpose()
            .map_err(|e| format!("serialize manifest: {e}"))?),
    })
}

// ── Shared DB operations (used by both DieselJobRepo and impl Repos) ──

async fn db_insert(pool: &deadpool_diesel::sqlite::Pool, org_id: &str, job: &Job) -> Result<(), String> {
    let new = to_new_job(job, org_id)?;
    pool
        .get()
        .await
        .map_err(|e| format!("pool: {e}"))?
        .interact(move |conn| {
            diesel::insert_into(dsl::jobs)
                .values(&new)
                .execute(conn)
        })
        .await
        .map_err(|e| format!("interact: {e}"))?
        .map_err(|e| format!("insert job: {e}"))?;
    Ok(())
}

async fn db_get(pool: &deadpool_diesel::sqlite::Pool, id: &str, org_id: &str) -> Option<Job> {
    let rid = id.to_string();
    let org = org_id.to_string();
    pool
        .get()
        .await
        .ok()?
        .interact(move |conn| {
            dsl::jobs
                .filter(dsl::id.eq(&rid).and(dsl::organization_id.eq(&org)))
                .select(JobRow::as_select())
                .first::<JobRow>(conn)
                .optional()
        })
        .await
        .ok()?
        .ok()?
        .map(Job::from)
}

async fn db_update(
    pool: &deadpool_diesel::sqlite::Pool,
    id: &str,
    org_id: &str,
    f: impl FnOnce(&mut Job),
) -> Result<Option<Job>, String> {
    let mut job = match db_get(pool, id, org_id).await {
        Some(j) => j,
        None => return Ok(None),
    };
    f(&mut job);

    let changeset = to_changeset(&job)?;
    let rid = id.to_string();
    let org = org_id.to_string();

    pool
        .get()
        .await
        .map_err(|e| format!("pool: {e}"))?
        .interact(move |conn| {
            diesel::update(
                dsl::jobs.filter(dsl::id.eq(&rid).and(dsl::organization_id.eq(&org))),
            )
            .set(&changeset)
            .execute(conn)
        })
        .await
        .map_err(|e| format!("interact: {e}"))?
        .map_err(|e| format!("update job: {e}"))?;

    Ok(Some(job))
}

async fn db_list(pool: &deadpool_diesel::sqlite::Pool, org_id: &str) -> Vec<Job> {
    let org = org_id.to_string();
    let Ok(pc) = pool.get().await else {
        return vec![];
    };
    let result = pc
        .interact(move |conn| {
            dsl::jobs
                .filter(dsl::organization_id.eq(&org))
                .order(dsl::created_at.desc())
                .select(JobRow::as_select())
                .load::<JobRow>(conn)
        })
        .await;
    match result {
        Ok(Ok(rows)) => rows.into_iter().map(Job::from).collect(),
        _ => vec![],
    }
}

async fn db_delete(pool: &deadpool_diesel::sqlite::Pool, id: &str, org_id: &str) -> Result<(), String> {
    let rid = id.to_string();
    let org = org_id.to_string();
    pool
        .get()
        .await
        .map_err(|e| format!("pool: {e}"))?
        .interact(move |conn| {
            diesel::delete(
                dsl::jobs.filter(dsl::id.eq(&rid).and(dsl::organization_id.eq(&org))),
            )
            .execute(conn)
        })
        .await
        .map_err(|e| format!("interact: {e}"))?
        .map_err(|e| format!("delete job: {e}"))?;
    Ok(())
}

// ── DieselJobRepo (implements the trait) ───────────────────────────────

pub struct DieselJobRepo {
    repos: Repos,
}

impl DieselJobRepo {
    pub fn new(repos: Repos) -> Self {
        Self { repos }
    }
}

#[async_trait]
impl JobRepository for DieselJobRepo {
    async fn insert(&self, tenant: &Tenant, job: &Job) -> Result<(), String> {
        db_insert(&self.repos.diesel_pool, tenant.org_id.as_str(), job).await
    }

    async fn get(&self, resource: &TenantResource<'_>) -> Option<Job> {
        db_get(&self.repos.diesel_pool, resource.id, resource.org_id.as_str()).await
    }

    async fn list(&self, tenant: &Tenant) -> Vec<Job> {
        db_list(&self.repos.diesel_pool, tenant.org_id.as_str()).await
    }

    async fn update(
        &self,
        resource: &TenantResource<'_>,
        f: JobUpdateFn,
    ) -> Result<Option<Job>, String> {
        db_update(&self.repos.diesel_pool, resource.id, resource.org_id.as_str(), f).await
    }

    async fn delete(&self, resource: &TenantResource<'_>) -> Result<(), String> {
        db_delete(&self.repos.diesel_pool, resource.id, resource.org_id.as_str()).await
    }
}

// ── impl Repos (kept for executor/runner.rs which uses Repos directly) ─

impl Repos {
    pub async fn insert_job(&self, tenant: &Tenant, job: &Job) -> Result<(), String> {
        db_insert(&self.diesel_pool, tenant.org_id.as_str(), job).await
    }

    pub async fn get_job(&self, resource: &TenantResource<'_>) -> Option<Job> {
        db_get(&self.diesel_pool, resource.id, resource.org_id.as_str()).await
    }

    pub async fn update_job(
        &self,
        resource: &TenantResource<'_>,
        f: impl FnOnce(&mut Job),
    ) -> Result<Option<Job>, String> {
        db_update(&self.diesel_pool, resource.id, resource.org_id.as_str(), f).await
    }

    pub async fn list_jobs(&self, tenant: &Tenant) -> Vec<Job> {
        db_list(&self.diesel_pool, tenant.org_id.as_str()).await
    }

    pub async fn remove_job(&self, resource: &TenantResource<'_>) -> Result<(), String> {
        db_delete(&self.diesel_pool, resource.id, resource.org_id.as_str()).await
    }
}
