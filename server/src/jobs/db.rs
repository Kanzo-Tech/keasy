use rusqlite::params;

use crate::db::Database;
use crate::tenant::TenantScoped;

use super::errors::JobRuntimeError;
use super::models::{Job, JobStatus, RunMode};
use super::pipeline_types::PipelineSummary;

impl Database {
    pub async fn insert_job(&self, ctx: &TenantScoped<()>, job: &Job) -> Result<(), String> {
        let error_json = job.error.as_ref()
            .map(|e| serde_json::to_string(e))
            .transpose()
            .map_err(|e| format!("failed to serialize error: {e}"))?;
        let pipeline_json = serde_json::to_string(&job.pipeline)
            .map_err(|e| format!("failed to serialize pipeline: {e}"))?;
        let account_ids_json = serde_json::to_string(&job.connection_ids)
            .map_err(|e| format!("failed to serialize connection_ids: {e}"))?;

        let conn = self.write().await;
        conn.execute(
            "INSERT INTO jobs (id, organization_id, name, status, mode, created_at, started_at, completed_at, error, pipeline, catalog, connection_ids, script)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                job.id,
                ctx.org_id().as_str(),
                job.name,
                job.status,
                job.mode,
                job.created_at,
                job.started_at,
                job.completed_at,
                error_json,
                pipeline_json,
                job.catalog,
                account_ids_json,
                job.script,
            ],
        )
        .map_err(|e| format!("failed to insert job: {e}"))?;

        Ok(())
    }

    pub async fn get_job(&self, ctx: &TenantScoped<&str>) -> Option<Job> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, status, mode, created_at, started_at, completed_at, error, pipeline, catalog, connection_ids, script
             FROM jobs WHERE id = ?1 AND organization_id = ?2",
            params![ctx.inner(), ctx.org_id().as_str()],
            |row| Ok(row_to_job(row)),
        )
        .ok()
    }

    pub async fn update_job(&self, ctx: &TenantScoped<&str>, f: impl FnOnce(&mut Job)) -> Result<Option<Job>, String> {
        let mut job = match self.get_job(ctx).await {
            Some(j) => j,
            None => return Ok(None),
        };
        f(&mut job);

        let error_json = job.error.as_ref()
            .map(|e| serde_json::to_string(e))
            .transpose()
            .map_err(|e| format!("failed to serialize error: {e}"))?;
        let pipeline_json = serde_json::to_string(&job.pipeline)
            .map_err(|e| format!("failed to serialize pipeline: {e}"))?;
        let account_ids_json = serde_json::to_string(&job.connection_ids)
            .map_err(|e| format!("failed to serialize connection_ids: {e}"))?;

        let conn = self.write().await;
        conn.execute(
            "UPDATE jobs SET name = ?1, status = ?2, started_at = ?3, completed_at = ?4, error = ?5, pipeline = ?6, catalog = ?7, connection_ids = ?8, script = ?9
             WHERE id = ?10 AND organization_id = ?11",
            params![
                job.name,
                job.status,
                job.started_at,
                job.completed_at,
                error_json,
                pipeline_json,
                job.catalog,
                account_ids_json,
                job.script,
                ctx.inner(),
                ctx.org_id().as_str(),
            ],
        )
        .map_err(|e| format!("failed to update job: {e}"))?;

        Ok(Some(job))
    }

    pub async fn list_jobs(&self, ctx: &TenantScoped<()>) -> Vec<Job> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, status, mode, created_at, started_at, completed_at, error, pipeline, catalog, connection_ids, script
                 FROM jobs WHERE organization_id = ?1 ORDER BY created_at DESC",
            )
            .expect("prepare list jobs");
        stmt.query_map([ctx.org_id().as_str()], |row| Ok(row_to_job(row)))
            .expect("query jobs")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn completed_catalogs(&self, ctx: &TenantScoped<()>) -> Vec<(String, String)> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, catalog FROM jobs WHERE status = 'completed' AND catalog IS NOT NULL AND organization_id = ?1",
            )
            .expect("prepare completed_catalogs");
        stmt.query_map([ctx.org_id().as_str()], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query completed_catalogs")
            .filter_map(|r| r.ok())
            .collect()
    }

    /// Return all completed catalogs across all orgs. Used at startup to restore
    /// the in-memory graph store without depending on a seed org ID.
    pub async fn completed_catalogs_all(&self) -> Vec<(String, String)> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, catalog FROM jobs WHERE status = 'completed' AND catalog IS NOT NULL",
            )
            .expect("prepare completed_catalogs_all");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query completed_catalogs_all")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn completed_job_ids_for_org(&self, org_id: &str) -> Vec<String> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id FROM jobs WHERE status = 'completed' AND organization_id = ?1",
            )
            .expect("prepare completed_job_ids_for_org");
        stmt.query_map([org_id], |row| row.get(0))
            .expect("query completed_job_ids_for_org")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn remove_job(&self, ctx: &TenantScoped<&str>) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "DELETE FROM jobs WHERE id = ?1 AND organization_id = ?2",
            params![ctx.inner(), ctx.org_id().as_str()],
        )
        .map_err(|e| format!("failed to delete job: {e}"))?;
        Ok(())
    }
}

fn row_to_job(row: &rusqlite::Row) -> Job {
    let status: JobStatus = row.get("status").unwrap_or(JobStatus::Pending);
    let error_json: Option<String> = row.get("error").unwrap_or(None);
    let pipeline_json: String = row.get("pipeline").unwrap_or_else(|_| {
        r#"{"inputs":[],"operations":[],"outputs":[]}"#.to_string()
    });
    let account_ids_json: String = row.get("connection_ids").unwrap_or_else(|_| "[]".to_string());
    let script: Option<String> = row.get("script").unwrap_or(None);
    let script = if status == JobStatus::Draft { script } else { None };

    Job {
        id: row.get("id").unwrap_or_default(),
        name: row.get("name").unwrap_or(None),
        status,
        mode: row.get("mode").unwrap_or(RunMode::Integrated),
        created_at: row.get("created_at").unwrap_or_default(),
        started_at: row.get("started_at").unwrap_or(None),
        completed_at: row.get("completed_at").unwrap_or(None),
        error: error_json.and_then(|j| serde_json::from_str::<JobRuntimeError>(&j).ok()),
        pipeline: serde_json::from_str::<PipelineSummary>(&pipeline_json).unwrap_or_default(),
        catalog: row.get("catalog").unwrap_or(None),
        dcat_input: None,
        connection_ids: serde_json::from_str::<Vec<String>>(&account_ids_json)
            .unwrap_or_default(),
        script,
    }
}
