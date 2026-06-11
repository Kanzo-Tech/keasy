use rusqlite::params;

use crate::db::Database;

use super::errors::JobRuntimeError;
use super::models::{Job, JobStatus, RunMode};

impl Database {
    pub async fn insert_job(&self, job: &Job) -> Result<(), String> {
        let error_json = job.error.as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize error: {e}"))?;
        let account_ids_json = serde_json::to_string(&job.connection_ids)
            .map_err(|e| format!("failed to serialize connection_ids: {e}"))?;

        let manifest_json = job.manifest.as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize manifest: {e}"))?;
        let catalog_manifest_json = job.catalog_manifest.as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize catalog_manifest: {e}"))?;

        let conn = self.write().await;
        conn.execute(
            "INSERT INTO jobs (id, name, status, mode, created_at, started_at, completed_at, error, connection_ids, script, manifest, catalog_manifest)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                job.id,
                job.name,
                job.status,
                job.mode,
                job.created_at,
                job.started_at,
                job.completed_at,
                error_json,
                account_ids_json,
                job.script,
                manifest_json,
                catalog_manifest_json,
            ],
        )
        .map_err(|e| format!("failed to insert job: {e}"))?;

        Ok(())
    }

    pub async fn get_job(&self, id: &str) -> Option<Job> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, status, mode, created_at, started_at, completed_at, error, connection_ids, script, manifest, catalog_manifest
             FROM jobs WHERE id = ?1",
            [id],
            |row| Ok(row_to_job(row)),
        )
        .ok()
    }

    pub async fn update_job(&self, id: &str, f: impl FnOnce(&mut Job)) -> Result<Option<Job>, String> {
        let mut job = match self.get_job(id).await {
            Some(j) => j,
            None => return Ok(None),
        };
        f(&mut job);

        let error_json = job.error.as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize error: {e}"))?;
        let account_ids_json = serde_json::to_string(&job.connection_ids)
            .map_err(|e| format!("failed to serialize connection_ids: {e}"))?;
        let manifest_json = job.manifest.as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize manifest: {e}"))?;
        let catalog_manifest_json = job.catalog_manifest.as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize catalog_manifest: {e}"))?;

        let conn = self.write().await;
        conn.execute(
            "UPDATE jobs SET name = ?1, status = ?2, started_at = ?3, completed_at = ?4, error = ?5, connection_ids = ?6, script = ?7, manifest = ?8, catalog_manifest = ?9
             WHERE id = ?10",
            params![
                job.name,
                job.status,
                job.started_at,
                job.completed_at,
                error_json,
                account_ids_json,
                job.script,
                manifest_json,
                catalog_manifest_json,
                id,
            ],
        )
        .map_err(|e| format!("failed to update job: {e}"))?;

        Ok(Some(job))
    }

    pub async fn list_jobs(&self) -> Vec<Job> {
        let (_permit, conn) = self.read().await;
        let mut stmt = match conn.prepare(
            "SELECT id, name, status, mode, created_at, started_at, completed_at, error, connection_ids, script, manifest, catalog_manifest
             FROM jobs ORDER BY created_at DESC",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "Failed to prepare list jobs");
                return vec![];
            }
        };
        match stmt.query_map([], |row| Ok(row_to_job(row))) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                tracing::error!(error = %e, "Failed to query jobs");
                vec![]
            }
        }
    }

    pub async fn remove_job(&self, id: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "DELETE FROM jobs WHERE id = ?1",
            [id],
        )
        .map_err(|e| format!("failed to delete job: {e}"))?;
        Ok(())
    }
}

fn row_to_job(row: &rusqlite::Row) -> Job {
    let status: JobStatus = row.get("status").unwrap_or_else(|e| {
        tracing::warn!(error = %e, "row_to_job: status type mismatch, defaulting to Pending");
        JobStatus::Pending
    });
    let error_json: Option<String> = row.get("error").unwrap_or_else(|e| {
        tracing::warn!(error = %e, "row_to_job: error column type mismatch");
        None
    });
    let account_ids_json: String = row.get("connection_ids").unwrap_or_else(|e| {
        tracing::warn!(error = %e, "row_to_job: connection_ids type mismatch, using empty list");
        "[]".to_string()
    });
    let script: Option<String> = row.get("script").unwrap_or_else(|e| {
        tracing::warn!(error = %e, "row_to_job: script column type mismatch");
        None
    });
    // The browser executor reads the program to run a `Pending` job (and to
    // re-run a `Running` one); terminal jobs expose only their manifest.
    let script = match status {
        JobStatus::Draft | JobStatus::Pending | JobStatus::Running => script,
        _ => None,
    };

    let manifest_json: Option<String> = row.get("manifest").unwrap_or_else(|e| {
        tracing::warn!(error = %e, "row_to_job: manifest column type mismatch");
        None
    });

    Job {
        id: row.get("id").unwrap_or_else(|e| {
            tracing::warn!(error = %e, "row_to_job: id type mismatch");
            String::new()
        }),
        name: row.get("name").unwrap_or_else(|e| {
            tracing::warn!(error = %e, "row_to_job: name column type mismatch");
            None
        }),
        status,
        mode: row.get("mode").unwrap_or_else(|e| {
            tracing::warn!(error = %e, "row_to_job: mode type mismatch, defaulting to Integrated");
            RunMode::Integrated
        }),
        created_at: row.get("created_at").unwrap_or_else(|e| {
            tracing::warn!(error = %e, "row_to_job: created_at type mismatch");
            String::new()
        }),
        started_at: row.get("started_at").unwrap_or_else(|e| {
            tracing::warn!(error = %e, "row_to_job: started_at column type mismatch");
            None
        }),
        completed_at: row.get("completed_at").unwrap_or_else(|e| {
            tracing::warn!(error = %e, "row_to_job: completed_at column type mismatch");
            None
        }),
        error: error_json.and_then(|j| serde_json::from_str::<JobRuntimeError>(&j).ok()),
        connection_ids: serde_json::from_str::<Vec<String>>(&account_ids_json)
            .unwrap_or_default(),
        script,
        manifest: manifest_json.and_then(|j| serde_json::from_str::<fossil_run_status::RunStatus>(&j).ok()),
        catalog_manifest: row.get::<_, Option<String>>("catalog_manifest")
            .unwrap_or(None)
            .and_then(|j| serde_json::from_str::<fossil_run_status::RunStatus>(&j).ok()),
    }
}
