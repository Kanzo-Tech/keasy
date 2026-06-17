use std::collections::HashMap;

use rusqlite::params;

use crate::db::Database;
use crate::jobs::models::Job;

use super::models::{
    Connection, CreateConnectionRequest, LocationType, UpdateConnectionRequest,
};

impl Database {
    pub async fn create_connection(
        &self,
        req: CreateConnectionRequest,
    ) -> Result<Connection, String> {
        req.validate()?;

        if let Some(ref account_id) = req.cloud_account_id
            && self.get_cloud_account_summary(account_id).await.is_none()
        {
            return Err(format!("cloud account not found: {account_id}"));
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

        let conn = self.write().await;
        conn.execute(
            "INSERT INTO connections (id, name, kind, location_type, direction, cloud_account_id, url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![connection.id, connection.name, connection.kind, connection.location_type, connection.direction, connection.cloud_account_id, connection.url],
        )
        .map_err(|e| format!("failed to create connection: {e}"))?;

        Ok(connection)
    }

    pub async fn get_connection(&self, id: &str) -> Option<Connection> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, kind, location_type, direction, cloud_account_id, url FROM connections WHERE id = ?1",
            [id],
            row_to_connection,
        )
        .ok()
    }

    pub async fn get_connection_by_name(&self, name: &str) -> Option<Connection> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, kind, location_type, direction, cloud_account_id, url FROM connections WHERE name = ?1",
            [name],
            row_to_connection,
        )
        .ok()
    }

    /// The workspace's write sink (the owner output store), if configured. There
    /// is at most one (enforced by the `connections_one_sink` unique index).
    pub async fn get_sink_connection(&self) -> Option<Connection> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, kind, location_type, direction, cloud_account_id, url FROM connections WHERE direction = 'sink'",
            [],
            row_to_connection,
        )
        .ok()
    }

    pub async fn list_connections(&self, type_filter: Option<&str>) -> Vec<Connection> {
        let (_permit, conn) = self.read().await;
        // Only READ sources are listed for the connector UI / `@conn` references;
        // the sink is the owner output store, managed via catalog-storage settings.
        let (sql, param): (&str, Option<&str>) = match type_filter {
            Some(t) => (
                "SELECT id, name, kind, location_type, direction, cloud_account_id, url FROM connections WHERE direction = 'source' AND kind = ?1 ORDER BY name",
                Some(t),
            ),
            None => (
                "SELECT id, name, kind, location_type, direction, cloud_account_id, url FROM connections WHERE direction = 'source' ORDER BY name",
                None,
            ),
        };

        let mut stmt = conn.prepare(sql).expect("prepare list connections");
        let rows = match param {
            Some(p) => stmt.query_map([p], row_to_connection),
            None => stmt.query_map([], row_to_connection),
        };
        rows.expect("query connections")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn update_connection(
        &self,
        id: &str,
        req: UpdateConnectionRequest,
    ) -> Result<Connection, String> {
        let existing = self
            .get_connection(id)
            .await
            .ok_or_else(|| format!("connection not found: {id}"))?;

        let name = req.name.unwrap_or(existing.name);
        let kind = req.kind.unwrap_or(existing.kind);
        let location_type = req.location_type.unwrap_or(existing.location_type);
        let direction = req.direction.unwrap_or(existing.direction);
        let cloud_account_id = if req.cloud_account_id.is_some() {
            req.cloud_account_id
        } else {
            existing.cloud_account_id
        };
        let url = req.url.unwrap_or(existing.url);

        if location_type == LocationType::Cloud && cloud_account_id.is_none() {
            return Err("cloud_account_id is required for cloud connections".into());
        }

        let conn = self.write().await;
        conn.execute(
            "UPDATE connections SET name = ?1, kind = ?2, location_type = ?3, direction = ?4, cloud_account_id = ?5, url = ?6 WHERE id = ?7",
            params![name, kind, location_type, direction, cloud_account_id, url, id],
        )
        .map_err(|e| format!("failed to update connection: {e}"))?;

        Ok(Connection {
            id: id.to_string(),
            name,
            kind,
            location_type,
            direction,
            cloud_account_id,
            url,
        })
    }

    pub async fn remove_connection(&self, id: &str) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "DELETE FROM connections WHERE id = ?1",
            [id],
        )
        .map_err(|e| format!("failed to delete connection: {e}"))?;
        Ok(())
    }

    /// Object-store creds for the **data space substrate** (the single workspace
    /// write sink). All job output lands under the substrate (prefixed by the
    /// producing member), so signing/reading it back uses the substrate account's
    /// creds — never the member source connections'. Empty if no cloud sink is
    /// configured.
    pub async fn substrate_storage_config(
        &self,
    ) -> HashMap<String, String> {
        match self.get_sink_connection().await.and_then(|c| c.cloud_account_id) {
            Some(account_id) => self.build_storage_config(std::slice::from_ref(&account_id)).await,
            None => HashMap::new(),
        }
    }

    /// `(base_url, object-store creds)` for a job's output destination. The
    /// member owns where their data product lands: the connection they chose at
    /// job config (`sink_connection_id`) wins; output is signed with that
    /// connection's cloud creds under `{base_url}/{job_id}`. Falls back to the
    /// workspace substrate when no destination was picked (transitional).
    /// `None` when neither is configured.
    pub async fn job_output_target(&self, job: &Job) -> Option<(String, HashMap<String, String>)> {
        if let Some(cid) = &job.sink_connection_id
            && let Some(conn) = self.get_connection(cid).await
        {
            let creds = match &conn.cloud_account_id {
                Some(account_id) => self.build_storage_config(std::slice::from_ref(account_id)).await,
                None => HashMap::new(),
            };
            return Some((conn.url, creds));
        }
        let (_, base) = self.substrate_config().await?;
        Some((base, self.substrate_storage_config().await))
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
