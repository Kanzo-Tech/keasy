use rusqlite::{OptionalExtension, params};

use crate::db::{Database, DbResult, json_column, json_column_opt};

use super::models::{Job, JobStatus};

const COLUMNS: &str = "id, name, status, mode, created_at, started_at, completed_at, error, \
                       connection_ids, created_by, sink_connection_id, script, manifest, relations";

impl Database {
    pub async fn insert_job(&self, job: &Job) -> DbResult<()> {
        self.insert(job, "").await.map(|_| ())
    }

    /// Insert `job` only into a workspace with no jobs; whether it was.
    pub async fn insert_first_job(&self, job: &Job) -> DbResult<bool> {
        self.insert(job, "WHERE NOT EXISTS (SELECT 1 FROM jobs)")
            .await
    }

    async fn insert(&self, job: &Job, condition: &str) -> DbResult<bool> {
        let inserted = self.write().await.execute(
            &format!(
                "INSERT INTO jobs ({COLUMNS})
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14 {condition}"
            ),
            params![
                job.id,
                job.name,
                job.status,
                job.mode,
                job.created_at,
                job.started_at,
                job.completed_at,
                job.error.as_ref().map(serde_json::to_string).transpose()?,
                serde_json::to_string(&job.connection_ids)?,
                job.created_by,
                job.sink_connection_id,
                job.script,
                job.manifest
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                serde_json::to_string(&job.relations)?,
            ],
        )?;
        Ok(inserted > 0)
    }

    pub async fn get_job(&self, id: &str) -> DbResult<Option<Job>> {
        Ok(self
            .read()
            .await
            .query_row(
                &format!("SELECT {COLUMNS} FROM jobs WHERE id = ?1"),
                [id],
                row_to_job,
            )
            .optional()?)
    }

    /// Apply `f` to the stored job and write it back; `None` if there is none.
    pub async fn update_job(&self, id: &str, f: impl FnOnce(&mut Job)) -> DbResult<Option<Job>> {
        let Some(mut job) = self.get_job(id).await? else {
            return Ok(None);
        };
        f(&mut job);

        self.write().await.execute(
            "UPDATE jobs SET name = ?1, status = ?2, started_at = ?3, completed_at = ?4, error = ?5,
                             connection_ids = ?6, script = ?7, manifest = ?8, relations = ?9
             WHERE id = ?10",
            params![
                job.name,
                job.status,
                job.started_at,
                job.completed_at,
                job.error.as_ref().map(serde_json::to_string).transpose()?,
                serde_json::to_string(&job.connection_ids)?,
                job.script,
                job.manifest.as_ref().map(serde_json::to_string).transpose()?,
                serde_json::to_string(&job.relations)?,
                id,
            ],
        )?;
        Ok(Some(job))
    }

    /// Every job in the workspace (the catalog and its reconciler).
    pub async fn list_jobs(&self) -> DbResult<Vec<Job>> {
        self.select_jobs("", None).await
    }

    /// The jobs `user_id` created.
    pub async fn list_jobs_of(&self, user_id: &str) -> DbResult<Vec<Job>> {
        self.select_jobs("WHERE created_by = ?1", Some(user_id))
            .await
    }

    /// Whether the workspace holds any job at all.
    pub async fn has_jobs(&self) -> DbResult<bool> {
        Ok(self
            .read()
            .await
            .query_row("SELECT EXISTS (SELECT 1 FROM jobs)", [], |row| row.get(0))?)
    }

    async fn select_jobs(&self, filter: &str, param: Option<&str>) -> DbResult<Vec<Job>> {
        let conn = self.read().await;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM jobs {filter} ORDER BY created_at DESC"
        ))?;
        let jobs = stmt
            .query_map(rusqlite::params_from_iter(param), row_to_job)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(jobs)
    }

    pub async fn remove_job(&self, id: &str) -> DbResult<()> {
        self.write()
            .await
            .execute("DELETE FROM jobs WHERE id = ?1", [id])?;
        Ok(())
    }
}

fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<Job> {
    let status: JobStatus = row.get("status")?;
    // The browser reads the program to run a `Pending` job (and to re-run a
    // `Running` one); a finished job exposes only its manifest.
    let script = match status {
        JobStatus::Draft | JobStatus::Pending | JobStatus::Running => row.get("script")?,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled => None,
    };
    Ok(Job {
        id: row.get("id")?,
        name: row.get("name")?,
        status,
        mode: row.get("mode")?,
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        completed_at: row.get("completed_at")?,
        error: json_column_opt(row, "error")?,
        connection_ids: json_column(row, "connection_ids")?,
        created_by: row.get("created_by")?,
        sink_connection_id: row.get("sink_connection_id")?,
        script,
        manifest: json_column_opt(row, "manifest")?,
        relations: json_column_opt(row, "relations")?.unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::models::{CreateJobRequest, Job};

    fn db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(
            &dir.path().join("keasy.db"),
            crate::crypto::SecretKey::for_tests(),
        )
        .unwrap();
        (db, dir)
    }

    fn job(owner: &str) -> Job {
        Job::requested(
            JobStatus::Draft,
            CreateJobRequest {
                script: "x".into(),
                name: None,
                mode: None,
                dcat_enabled: None,
                connection_ids: vec![],
                sink_connection_id: "sink".into(),
                draft: true,
            },
            owner.into(),
        )
    }

    /// A row that does not decode is an error, not a job with defaults filled in.
    #[tokio::test]
    async fn a_corrupt_row_is_an_error_not_a_default() {
        let (db, _dir) = db();
        let stored = job("u-1");
        db.insert_job(&stored).await.unwrap();
        db.write()
            .await
            .execute("UPDATE jobs SET status = 'exploded'", [])
            .unwrap();

        assert!(db.get_job(&stored.id).await.is_err());
        assert!(db.list_jobs().await.is_err());

        db.write()
            .await
            .execute(
                "UPDATE jobs SET status = 'draft', connection_ids = 'not json'",
                [],
            )
            .unwrap();
        assert!(db.get_job(&stored.id).await.is_err());
    }

    #[tokio::test]
    async fn only_the_first_job_of_a_workspace_is_inserted_as_first() {
        let (db, _dir) = db();
        assert!(db.insert_first_job(&job("u-1")).await.unwrap());
        assert!(!db.insert_first_job(&job("u-2")).await.unwrap());
        assert_eq!(db.list_jobs().await.unwrap().len(), 1);
    }
}
