use std::collections::HashMap;

use rusqlite::{ErrorCode, OptionalExtension, params};

use crate::db::{Database, DbError, DbResult};
use crate::jobs::models::Job;

use super::models::{Connection, CreateConnectionRequest, LocationType, UpdateConnectionRequest};

const COLUMNS: &str = "id, name, kind, location_type, direction, cloud_account_id, url";

/// A write the schema refused — a second connection of that name, a second
/// sink — is the caller's to fix, not a failure of the store.
fn refused(e: rusqlite::Error) -> DbError {
    match e.sqlite_error_code() {
        Some(ErrorCode::ConstraintViolation) => DbError::Invalid(
            "a connection with that name already exists, or the workspace already has a sink"
                .into(),
        ),
        _ => e.into(),
    }
}

impl Database {
    pub async fn create_connection(&self, req: CreateConnectionRequest) -> DbResult<Connection> {
        req.validate().map_err(DbError::Invalid)?;

        if let Some(ref account_id) = req.cloud_account_id
            && self.get_cloud_account_summary(account_id).await?.is_none()
        {
            return Err(DbError::Invalid(format!(
                "cloud account not found: {account_id}"
            )));
        }

        let connection = Connection {
            id: uuid::Uuid::new_v4().to_string(),
            name: req.name,
            kind: req.kind,
            location_type: req.location_type,
            direction: req.direction,
            cloud_account_id: req.cloud_account_id,
            url: req.url,
        };

        self.write()
            .await
            .execute(
                &format!("INSERT INTO connections ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"),
                params![
                    connection.id,
                    connection.name,
                    connection.kind,
                    connection.location_type,
                    connection.direction,
                    connection.cloud_account_id,
                    connection.url
                ],
            )
            .map_err(refused)?;

        Ok(connection)
    }

    async fn connection_where(
        &self,
        filter: &str,
        param: Option<&str>,
    ) -> DbResult<Option<Connection>> {
        Ok(self
            .read()
            .await
            .query_row(
                &format!("SELECT {COLUMNS} FROM connections WHERE {filter}"),
                rusqlite::params_from_iter(param),
                row_to_connection,
            )
            .optional()?)
    }

    pub async fn get_connection(&self, id: &str) -> DbResult<Option<Connection>> {
        self.connection_where("id = ?1", Some(id)).await
    }

    pub async fn get_connection_by_name(&self, name: &str) -> DbResult<Option<Connection>> {
        self.connection_where("name = ?1", Some(name)).await
    }

    /// The workspace's write sink, if configured. There is at most one (the
    /// `connections_one_sink` index).
    pub async fn get_sink_connection(&self) -> DbResult<Option<Connection>> {
        self.connection_where("direction = 'sink'", None).await
    }

    /// Sources and sinks alike, optionally of one `kind`.
    pub async fn list_connections(&self, kind: Option<&str>) -> DbResult<Vec<Connection>> {
        let filter = if kind.is_some() {
            "WHERE kind = ?1"
        } else {
            ""
        };
        let conn = self.read().await;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM connections {filter} ORDER BY name"
        ))?;
        let connections = stmt
            .query_map(rusqlite::params_from_iter(kind), row_to_connection)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(connections)
    }

    pub async fn update_connection(
        &self,
        id: &str,
        req: UpdateConnectionRequest,
    ) -> DbResult<Connection> {
        let existing = self
            .get_connection(id)
            .await?
            .ok_or_else(|| DbError::Invalid(format!("connection not found: {id}")))?;

        let updated = Connection {
            id: id.to_string(),
            name: req.name.unwrap_or(existing.name),
            kind: req.kind.unwrap_or(existing.kind),
            location_type: req.location_type.unwrap_or(existing.location_type),
            direction: req.direction.unwrap_or(existing.direction),
            cloud_account_id: req.cloud_account_id.or(existing.cloud_account_id),
            url: req.url.unwrap_or(existing.url),
        };
        if updated.location_type == LocationType::Cloud && updated.cloud_account_id.is_none() {
            return Err(DbError::Invalid(
                "cloud_account_id is required for cloud connections".into(),
            ));
        }

        self.write()
            .await
            .execute(
                "UPDATE connections SET name = ?1, kind = ?2, location_type = ?3, direction = ?4,
                                        cloud_account_id = ?5, url = ?6
                 WHERE id = ?7",
                params![
                    updated.name,
                    updated.kind,
                    updated.location_type,
                    updated.direction,
                    updated.cloud_account_id,
                    updated.url,
                    id
                ],
            )
            .map_err(refused)?;
        Ok(updated)
    }

    pub async fn remove_connection(&self, id: &str) -> DbResult<()> {
        self.write()
            .await
            .execute("DELETE FROM connections WHERE id = ?1", [id])?;
        Ok(())
    }

    /// `(base_url, object-store creds)` of a job's destination sink; `None` once
    /// that connection is gone.
    pub async fn job_output_target(
        &self,
        job: &Job,
    ) -> DbResult<Option<(String, HashMap<String, String>)>> {
        let Some(conn) = self.get_connection(&job.sink_connection_id).await? else {
            return Ok(None);
        };
        let creds = self.connection_credentials(&conn).await?;
        Ok(Some((conn.url, creds)))
    }

    /// The object-store configuration a connection's cloud account signs with;
    /// empty for a connection without one.
    pub async fn connection_credentials(
        &self,
        conn: &Connection,
    ) -> DbResult<HashMap<String, String>> {
        match &conn.cloud_account_id {
            Some(account_id) => {
                self.build_storage_config(std::slice::from_ref(account_id))
                    .await
            }
            None => Ok(HashMap::new()),
        }
    }
}

fn row_to_connection(row: &rusqlite::Row<'_>) -> rusqlite::Result<Connection> {
    Ok(Connection {
        id: row.get("id")?,
        name: row.get("name")?,
        kind: row.get("kind")?,
        location_type: row.get("location_type")?,
        direction: row.get("direction")?,
        cloud_account_id: row.get("cloud_account_id")?,
        url: row.get("url")?,
    })
}
