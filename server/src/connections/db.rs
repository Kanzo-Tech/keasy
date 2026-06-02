use std::sync::Arc;

use rusqlite::params;

use fossil_lang::traits::resolver::PathResolver;

use crate::db::Database;
use crate::jobs::path_resolver::KeasyPathResolver;
use crate::tenant::{OrgId, TenantScoped};

use super::models::{
    Connection, CreateConnectionRequest, LocationType, UpdateConnectionRequest,
};

impl Database {
    pub async fn create_connection(
        &self,
        ctx: &TenantScoped<()>,
        req: CreateConnectionRequest,
    ) -> Result<Connection, String> {
        req.validate()?;

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
            params![connection.id, ctx.org_id().as_str(), connection.name, connection.kind, connection.location_type, connection.cloud_account_id, connection.url],
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
            params![name, kind, location_type, cloud_account_id, url, ctx.inner(), ctx.org_id().as_str()],
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

    pub async fn remove_connection(&self, ctx: &TenantScoped<&str>) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "DELETE FROM connections WHERE id = ?1 AND organization_id = ?2",
            params![ctx.inner(), ctx.org_id().as_str()],
        )
        .map_err(|e| format!("failed to delete connection: {e}"))?;
        Ok(())
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
    ) -> std::collections::HashMap<String, String> {
        let account_ids = self.resolve_cloud_account_ids(ctx, connection_ids).await;
        self.build_storage_config(ctx, &account_ids).await
    }

    /// Build a PathResolver from ALL connections in an org (for validation/analysis).
    pub async fn build_path_resolver_for_org(
        &self,
        ctx: &TenantScoped<()>,
    ) -> Result<Arc<dyn PathResolver>, String> {
        let connections = self.list_connections(ctx, None).await;
        let mut entries = Vec::new();
        for conn in connections {
            let creds = if let Some(ref account_id) = conn.cloud_account_id {
                self.build_storage_config(ctx, &[account_id.clone()]).await
            } else {
                std::collections::HashMap::new()
            };
            entries.push((conn.name, conn.url, creds));
        }
        Ok(Arc::new(KeasyPathResolver::from_connections(entries)))
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
