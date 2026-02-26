use rusqlite::params;
use tracing::error;

use crate::db::Database;
use crate::tenant::{OrgId, TenantScoped};

use super::models::{
    Connection, ConnectionKind, CreateConnectionRequest, LocationType, UpdateConnectionRequest,
};

impl Database {
    pub async fn create_connection(
        &self,
        ctx: &TenantScoped<()>,
        req: CreateConnectionRequest,
    ) -> Result<Connection, String> {
        if req.name.trim().is_empty() {
            return Err("name is required".into());
        }
        if req.url.trim().is_empty() {
            return Err("url is required".into());
        }
        if req.location_type == LocationType::Cloud && req.cloud_account_id.is_none() {
            return Err("cloud_account_id is required for cloud connections".into());
        }

        if let Some(ref account_id) = req.cloud_account_id
            && self
                .get_cloud_account_summary(&TenantScoped::new(ctx.org_id.clone(), account_id.as_str()))
                .await
                .is_none()
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
            "INSERT INTO connections (id, organization_id, name, kind, location_type, cloud_account_id, url) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![connection.id, ctx.org_id().as_str(), connection.name, connection.kind.as_str(), connection.location_type.as_str(), connection.cloud_account_id, connection.url],
        )
        .map_err(|e| format!("failed to create connection: {e}"))?;

        Ok(connection)
    }

    pub async fn get_connection(&self, ctx: &TenantScoped<&str>) -> Option<Connection> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, kind, location_type, cloud_account_id, url FROM connections WHERE id = ?1 AND organization_id = ?2",
            params![ctx.inner(), ctx.org_id().as_str()],
            row_to_connection,
        )
        .ok()
    }

    pub async fn get_connection_by_name(&self, ctx: &TenantScoped<&str>) -> Option<Connection> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, kind, location_type, cloud_account_id, url FROM connections WHERE name = ?1 AND organization_id = ?2",
            params![ctx.inner(), ctx.org_id().as_str()],
            row_to_connection,
        )
        .ok()
    }

    pub async fn list_connections(
        &self,
        ctx: &TenantScoped<()>,
        type_filter: Option<&str>,
    ) -> Vec<Connection> {
        let (_permit, conn) = self.read().await;
        let (sql, param): (&str, Option<&str>) = match type_filter {
            Some(t) => (
                "SELECT id, name, kind, location_type, cloud_account_id, url FROM connections WHERE kind = ?1 AND organization_id = ?2 ORDER BY name",
                Some(t),
            ),
            None => (
                "SELECT id, name, kind, location_type, cloud_account_id, url FROM connections WHERE organization_id = ?1 ORDER BY name",
                None,
            ),
        };

        if let Some(p) = param {
            let mut stmt = conn.prepare(sql).expect("prepare list connections");
            stmt.query_map(params![p, ctx.org_id().as_str()], row_to_connection)
                .expect("query connections")
                .filter_map(|r| r.ok())
                .collect()
        } else {
            let mut stmt = conn.prepare(sql).expect("prepare list connections");
            stmt.query_map([ctx.org_id().as_str()], row_to_connection)
                .expect("query connections")
                .filter_map(|r| r.ok())
                .collect()
        }
    }

    pub async fn update_connection(
        &self,
        ctx: &TenantScoped<&str>,
        req: UpdateConnectionRequest,
    ) -> Result<Connection, String> {
        let existing = self
            .get_connection(ctx)
            .await
            .ok_or_else(|| format!("connection not found: {}", ctx.inner()))?;

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
            "UPDATE connections SET name = ?1, kind = ?2, location_type = ?3, cloud_account_id = ?4, url = ?5 WHERE id = ?6 AND organization_id = ?7",
            params![name, kind.as_str(), location_type.as_str(), cloud_account_id, url, ctx.inner(), ctx.org_id().as_str()],
        )
        .map_err(|e| format!("failed to update connection: {e}"))?;

        Ok(Connection {
            id: ctx.inner().to_string(),
            name,
            kind,
            location_type,
            cloud_account_id,
            url,
        })
    }

    pub async fn remove_connection(&self, ctx: &TenantScoped<&str>) {
        let conn = self.write().await;
        if let Err(e) = conn.execute(
            "DELETE FROM connections WHERE id = ?1 AND organization_id = ?2",
            params![ctx.inner(), ctx.org_id().as_str()],
        ) {
            error!(connection_id = %ctx.inner(), error = %e, "failed to delete connection");
        }
    }

    pub async fn resolve_cloud_account_ids(
        &self,
        ctx: &TenantScoped<()>,
        connection_ids: &[String],
    ) -> Vec<String> {
        let mut account_ids = Vec::new();
        for connection_id in connection_ids {
            let scoped = TenantScoped::new(OrgId(ctx.org_id().as_str().to_string()), connection_id.as_str());
            if let Some(connection) = self.get_connection(&scoped).await
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
        ctx: &TenantScoped<()>,
        connection_ids: &[String],
    ) -> fossil_lang::runtime::storage::StorageConfig {
        let account_ids = self.resolve_cloud_account_ids(ctx, connection_ids).await;
        self.build_storage_config(ctx, ctx.org_id().as_str(), &account_ids).await
    }
}

fn row_to_connection(row: &rusqlite::Row<'_>) -> rusqlite::Result<Connection> {
    let kind_str: String = row.get(2)?;
    let location_type_str: String = row.get(3)?;

    let kind = match kind_str.as_str() {
        "vocab" => ConnectionKind::Vocab,
        _ => ConnectionKind::Data,
    };
    let location_type = match location_type_str.as_str() {
        "local" => LocationType::Local,
        _ => LocationType::Cloud,
    };

    Ok(Connection {
        id: row.get(0)?,
        name: row.get(1)?,
        kind,
        location_type,
        cloud_account_id: row.get(4)?,
        url: row.get(5)?,
    })
}
