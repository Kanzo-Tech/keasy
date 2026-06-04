use rusqlite::params;

use crate::db::Database;

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
            cloud_account_id: req.cloud_account_id,
            url: req.url,
        };

        let conn = self.write().await;
        conn.execute(
            "INSERT INTO connections (id, name, kind, location_type, cloud_account_id, url) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![connection.id, connection.name, connection.kind, connection.location_type, connection.cloud_account_id, connection.url],
        )
        .map_err(|e| format!("failed to create connection: {e}"))?;

        Ok(connection)
    }

    pub async fn get_connection(&self, id: &str) -> Option<Connection> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, kind, location_type, cloud_account_id, url FROM connections WHERE id = ?1",
            [id],
            row_to_connection,
        )
        .ok()
    }

    pub async fn get_connection_by_name(&self, name: &str) -> Option<Connection> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, kind, location_type, cloud_account_id, url FROM connections WHERE name = ?1",
            [name],
            row_to_connection,
        )
        .ok()
    }

    pub async fn list_connections(&self, type_filter: Option<&str>) -> Vec<Connection> {
        let (_permit, conn) = self.read().await;
        let (sql, param): (&str, Option<&str>) = match type_filter {
            Some(t) => (
                "SELECT id, name, kind, location_type, cloud_account_id, url FROM connections WHERE kind = ?1 ORDER BY name",
                Some(t),
            ),
            None => (
                "SELECT id, name, kind, location_type, cloud_account_id, url FROM connections ORDER BY name",
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
            "UPDATE connections SET name = ?1, kind = ?2, location_type = ?3, cloud_account_id = ?4, url = ?5 WHERE id = ?6",
            params![name, kind, location_type, cloud_account_id, url, id],
        )
        .map_err(|e| format!("failed to update connection: {e}"))?;

        Ok(Connection {
            id: id.to_string(),
            name,
            kind,
            location_type,
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

    pub async fn resolve_cloud_account_ids(&self, connection_ids: &[String]) -> Vec<String> {
        let mut account_ids = Vec::new();
        for connection_id in connection_ids {
            if let Some(connection) = self.get_connection(connection_id).await
                && let Some(account_id) = &connection.cloud_account_id
                && !account_ids.contains(account_id)
            {
                account_ids.push(account_id.clone());
            }
        }
        account_ids
    }

    pub async fn build_storage_config_from_connections(
        &self,
        connection_ids: &[String],
    ) -> std::collections::HashMap<String, String> {
        let account_ids = self.resolve_cloud_account_ids(connection_ids).await;
        self.build_storage_config(&account_ids).await
    }
}

fn row_to_connection(row: &rusqlite::Row<'_>) -> rusqlite::Result<Connection> {
    Ok(Connection {
        id: row.get("id")?,
        name: row.get("name")?,
        kind: row.get("kind")?,
        location_type: row.get("location_type")?,
        cloud_account_id: row.get("cloud_account_id")?,
        url: row.get("url")?,
    })
}
