//! The `dashboards` table: one saved dashboard per job, stored opaque.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{DbResult, json_column};
use crate::domain::{Dashboard, now_iso8601};

pub fn get(conn: &Connection, job_id: &str) -> DbResult<Option<Dashboard>> {
    Ok(conn
        .query_row(
            "SELECT spec, updated_at, updated_by FROM dashboards WHERE job_id = ?1",
            [job_id],
            |row| {
                Ok(Dashboard {
                    spec: json_column(row, "spec")?,
                    updated_at: row.get("updated_at")?,
                    updated_by: row.get("updated_by")?,
                })
            },
        )
        .optional()?)
}

/// Replace the job's dashboard with `spec`.
pub fn put(
    conn: &Connection,
    job_id: &str,
    spec: serde_json::Map<String, serde_json::Value>,
    by: &str,
) -> DbResult<Dashboard> {
    let dashboard = Dashboard {
        spec,
        updated_at: now_iso8601(),
        updated_by: by.to_string(),
    };
    conn.execute(
        "INSERT INTO dashboards (job_id, spec, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (job_id) DO UPDATE SET
             spec = excluded.spec, updated_at = excluded.updated_at,
             updated_by = excluded.updated_by",
        params![
            job_id,
            serde_json::to_string(&dashboard.spec)?,
            dashboard.updated_at,
            dashboard.updated_by,
        ],
    )?;
    Ok(dashboard)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Job;
    use serde_json::json;

    fn conn_with_job() -> (Connection, String) {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        crate::connections::persistence::tests::seed_sink(&conn, "sink");
        let job = Job::new(None, "sink".into(), None, "x".into(), "u-1".into());
        crate::jobs::persistence::insert(&conn, &job).unwrap();
        (conn, job.id)
    }

    fn object(v: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        v.as_object().unwrap().clone()
    }

    /// Saved, replaced and read back verbatim; gone with its job.
    #[test]
    fn a_dashboard_is_the_last_spec_saved_and_dies_with_its_job() {
        let (conn, id) = conn_with_job();
        assert!(get(&conn, &id).unwrap().is_none());

        put(&conn, &id, object(json!({ "cards": [1] })), "u-1").unwrap();
        put(
            &conn,
            &id,
            object(json!({ "cards": [2], "x": { "y": null } })),
            "u-1",
        )
        .unwrap();
        let saved = get(&conn, &id).unwrap().unwrap();
        assert_eq!(
            serde_json::Value::Object(saved.spec),
            json!({ "cards": [2], "x": { "y": null } })
        );
        assert_eq!(saved.updated_by, "u-1");

        crate::jobs::persistence::delete(&conn, &id).unwrap();
        assert!(get(&conn, &id).unwrap().is_none());
    }

    #[test]
    fn a_dashboard_needs_its_job() {
        let (conn, _) = conn_with_job();
        assert!(put(&conn, "no-such-job", object(json!({})), "u-1").is_err());
    }
}
