use rusqlite::params;

use crate::db::Database;

use super::errors::JobRuntimeError;
use super::models::{Job, JobStatus, OutputRelation, RunMode};

impl Database {
    pub async fn insert_job(&self, job: &Job) -> Result<(), String> {
        self.insert(job, "").await.map(|_| ())
    }

    /// Insert `job` only into a workspace with no jobs; whether it was.
    pub async fn insert_first_job(&self, job: &Job) -> Result<bool, String> {
        self.insert(job, "WHERE NOT EXISTS (SELECT 1 FROM jobs)")
            .await
    }

    async fn insert(&self, job: &Job, condition: &str) -> Result<bool, String> {
        let error_json = job
            .error
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize error: {e}"))?;
        let account_ids_json = serde_json::to_string(&job.connection_ids)
            .map_err(|e| format!("failed to serialize connection_ids: {e}"))?;

        let manifest_json = job
            .manifest
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize manifest: {e}"))?;
        let relations_json = serde_json::to_string(&job.relations)
            .map_err(|e| format!("failed to serialize relations: {e}"))?;

        let conn = self.write().await;
        let inserted = conn.execute(
            &format!("INSERT INTO jobs (id, name, status, mode, created_at, started_at, completed_at, error, connection_ids, created_by, sink_connection_id, script, manifest, relations)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14 {condition}"),
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
                job.created_by,
                job.sink_connection_id,
                job.script,
                manifest_json,
                relations_json,
            ],
        )
        .map_err(|e| format!("failed to insert job: {e}"))?;

        Ok(inserted > 0)
    }

    pub async fn get_job(&self, id: &str) -> Option<Job> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, status, mode, created_at, started_at, completed_at, error, connection_ids, created_by, sink_connection_id, script, manifest, relations
             FROM jobs WHERE id = ?1",
            [id],
            |row| Ok(row_to_job(row)),
        )
        .ok()
    }

    pub async fn update_job(
        &self,
        id: &str,
        f: impl FnOnce(&mut Job),
    ) -> Result<Option<Job>, String> {
        let mut job = match self.get_job(id).await {
            Some(j) => j,
            None => return Ok(None),
        };
        f(&mut job);

        let error_json = job
            .error
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize error: {e}"))?;
        let account_ids_json = serde_json::to_string(&job.connection_ids)
            .map_err(|e| format!("failed to serialize connection_ids: {e}"))?;
        let manifest_json = job
            .manifest
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("failed to serialize manifest: {e}"))?;
        let relations_json = serde_json::to_string(&job.relations)
            .map_err(|e| format!("failed to serialize relations: {e}"))?;

        let conn = self.write().await;
        conn.execute(
            "UPDATE jobs SET name = ?1, status = ?2, started_at = ?3, completed_at = ?4, error = ?5, connection_ids = ?6, script = ?7, manifest = ?8, relations = ?9
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
                relations_json,
                id,
            ],
        )
        .map_err(|e| format!("failed to update job: {e}"))?;

        Ok(Some(job))
    }

    /// Every job in the workspace (the catalog and its reconciler).
    pub async fn list_jobs(&self) -> Vec<Job> {
        self.select_jobs("", None).await
    }

    /// The jobs `user_id` created.
    pub async fn list_jobs_of(&self, user_id: &str) -> Vec<Job> {
        self.select_jobs("WHERE created_by = ?1", Some(user_id))
            .await
    }

    /// Whether the workspace holds any job at all.
    pub async fn has_jobs(&self) -> bool {
        let (_permit, conn) = self.read().await;
        conn.query_row("SELECT EXISTS (SELECT 1 FROM jobs)", [], |row| row.get(0))
            .unwrap_or(true)
    }

    async fn select_jobs(&self, filter: &str, param: Option<&str>) -> Vec<Job> {
        let (_permit, conn) = self.read().await;
        let mut stmt = match conn.prepare(&format!(
            "SELECT id, name, status, mode, created_at, started_at, completed_at, error, connection_ids, created_by, sink_connection_id, script, manifest, relations
             FROM jobs {filter} ORDER BY created_at DESC"
        )) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "Failed to prepare list jobs");
                return vec![];
            }
        };
        match stmt.query_map(rusqlite::params_from_iter(param), |row| Ok(row_to_job(row))) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                tracing::error!(error = %e, "Failed to query jobs");
                vec![]
            }
        }
    }

    pub async fn remove_job(&self, id: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute("DELETE FROM jobs WHERE id = ?1", [id])
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
        connection_ids: serde_json::from_str::<Vec<String>>(&account_ids_json).unwrap_or_default(),
        created_by: row.get("created_by").unwrap_or_default(),
        sink_connection_id: row.get("sink_connection_id").unwrap_or_default(),
        script,
        manifest: manifest_json.and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok()),
        relations: row
            .get::<_, Option<String>>("relations")
            .unwrap_or(None)
            .and_then(|j| serde_json::from_str::<Vec<OutputRelation>>(&j).ok())
            .unwrap_or_default(),
    }
}
