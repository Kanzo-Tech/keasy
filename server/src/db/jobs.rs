use rusqlite::params;
use tracing::error;

use crate::job::errors::JobError;
use crate::job::types::{Job, JobStatus, RunMode};
use crate::pipeline::PipelineSummary;

use super::Database;

impl Database {
    pub async fn insert_job(&self, job: &Job) {
        let status = serialize_status(&job.status);
        let mode = serialize_mode(&job.mode);
        let error_json = job.error.as_ref().map(|e| serde_json::to_string(e).unwrap());
        let pipeline_json = serde_json::to_string(&job.pipeline).unwrap();
        let account_ids_json = serde_json::to_string(&job.connection_ids).unwrap();

        let conn = self.conn.lock().await;
        if let Err(e) = conn.execute(
            "INSERT INTO jobs (id, name, status, mode, created_at, started_at, completed_at, error, pipeline, catalog, connection_ids, script)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                job.id,
                job.name,
                status,
                mode,
                job.created_at,
                job.started_at,
                job.completed_at,
                error_json,
                pipeline_json,
                job.catalog,
                account_ids_json,
                job.script,
            ],
        ) {
            error!(job_id = %job.id, error = %e, "failed to insert job");
        }
    }

    pub async fn get_job(&self, id: &str) -> Option<Job> {
        let conn = self.conn.lock().await;
        conn.query_row(
            "SELECT id, name, status, mode, created_at, started_at, completed_at, error, pipeline, catalog, connection_ids, script
             FROM jobs WHERE id = ?1",
            [id],
            |row| Ok(row_to_job(row)),
        )
        .ok()
    }

    pub async fn update_job(&self, id: &str, f: impl FnOnce(&mut Job)) -> Option<Job> {
        let mut job = self.get_job(id).await?;
        f(&mut job);

        let status = serialize_status(&job.status);
        let error_json = job.error.as_ref().map(|e| serde_json::to_string(e).unwrap());
        let pipeline_json = serde_json::to_string(&job.pipeline).unwrap();
        let account_ids_json = serde_json::to_string(&job.connection_ids).unwrap();

        let conn = self.conn.lock().await;
        if let Err(e) = conn.execute(
            "UPDATE jobs SET name = ?1, status = ?2, started_at = ?3, completed_at = ?4, error = ?5, pipeline = ?6, catalog = ?7, connection_ids = ?8, script = ?9
             WHERE id = ?10",
            params![
                job.name,
                status,
                job.started_at,
                job.completed_at,
                error_json,
                pipeline_json,
                job.catalog,
                account_ids_json,
                job.script,
                id,
            ],
        ) {
            error!(job_id = %id, error = %e, "failed to update job");
        }

        Some(job)
    }

    pub async fn list_jobs(&self) -> Vec<Job> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, status, mode, created_at, started_at, completed_at, error, pipeline, catalog, connection_ids, script
                 FROM jobs ORDER BY created_at DESC",
            )
            .expect("prepare list jobs");
        stmt.query_map([], |row| Ok(row_to_job(row)))
            .expect("query jobs")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn completed_catalogs(&self) -> Vec<(String, String)> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, catalog FROM jobs WHERE status = 'completed' AND catalog IS NOT NULL",
            )
            .expect("prepare completed_catalogs");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query completed_catalogs")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn remove_job(&self, id: &str) {
        let conn = self.conn.lock().await;
        if let Err(e) = conn.execute("DELETE FROM jobs WHERE id = ?1", [id]) {
            error!(job_id = %id, error = %e, "failed to delete job");
        }
    }
}

fn serialize_status(status: &JobStatus) -> &'static str {
    match status {
        JobStatus::Draft => "draft",
        JobStatus::Pending => "pending",
        JobStatus::Running => "running",
        JobStatus::Completed => "completed",
        JobStatus::Failed => "failed",
        JobStatus::Cancelled => "cancelled",
    }
}

fn deserialize_status(s: &str) -> JobStatus {
    match s {
        "draft" => JobStatus::Draft,
        "pending" => JobStatus::Pending,
        "running" => JobStatus::Running,
        "completed" => JobStatus::Completed,
        "failed" => JobStatus::Failed,
        "cancelled" => JobStatus::Cancelled,
        _ => JobStatus::Pending,
    }
}

fn serialize_mode(mode: &RunMode) -> &'static str {
    match mode {
        RunMode::Integrated => "integrated",
        RunMode::Scheduled => "scheduled",
    }
}

fn deserialize_mode(s: &str) -> RunMode {
    match s {
        "scheduled" => RunMode::Scheduled,
        _ => RunMode::Integrated,
    }
}

fn row_to_job(row: &rusqlite::Row) -> Job {
    let status_str: String = row.get(2).unwrap_or_default();
    let mode_str: String = row.get(3).unwrap_or_default();
    let error_json: Option<String> = row.get(7).unwrap_or(None);
    let pipeline_json: String = row.get(8).unwrap_or_else(|_| {
        r#"{"inputs":[],"operations":[],"outputs":[]}"#.to_string()
    });
    let account_ids_json: String = row.get(10).unwrap_or_else(|_| "[]".to_string());

    let status = deserialize_status(&status_str);
    let script: Option<String> = row.get(11).unwrap_or(None);
    let script = if status == JobStatus::Draft { script } else { None };

    Job {
        id: row.get(0).unwrap_or_default(),
        name: row.get(1).unwrap_or(None),
        status,
        mode: deserialize_mode(&mode_str),
        created_at: row.get(4).unwrap_or_default(),
        started_at: row.get(5).unwrap_or(None),
        completed_at: row.get(6).unwrap_or(None),
        error: error_json.and_then(|j| serde_json::from_str::<JobError>(&j).ok()),
        pipeline: serde_json::from_str::<PipelineSummary>(&pipeline_json).unwrap_or_default(),
        catalog: row.get(9).unwrap_or(None),
        dcat_input: None,
        connection_ids: serde_json::from_str::<Vec<String>>(&account_ids_json)
            .unwrap_or_default(),
        script,
    }
}
