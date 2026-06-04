use rusqlite::params;

use super::Database;

/// A registered workspace instance (OIDC client), keyed by `client_id`. Display
/// metadata for the federation switcher; OIDC credentials live in Keycloak only.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct Workspace {
    pub client_id: String,
    pub name: String,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    /// Idempotent upsert — registers a workspace if it doesn't exist yet (by client_id).
    /// Used at startup to self-register and register federation peers.
    pub async fn ensure_workspace(
        &self,
        client_id: &str,
        name: &str,
        url: &str,
    ) -> Result<(), String> {
        let conn = self.write().await;
        let now = jiff::Timestamp::now().to_string();
        conn.execute(
            "INSERT INTO workspaces (client_id, name, url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(client_id) DO UPDATE SET name = ?2, url = ?3, updated_at = ?4",
            params![client_id, name, url, now],
        )
        .map_err(|e| format!("ensure_workspace: {e}"))?;
        Ok(())
    }

    /// Batch lookup: returns all workspaces whose client_id is in the given list.
    pub async fn get_workspaces_by_client_ids(&self, client_ids: &[&str]) -> Vec<Workspace> {
        if client_ids.is_empty() {
            return Vec::new();
        }
        let (_permit, conn) = self.read().await;
        let placeholders: Vec<String> = (1..=client_ids.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT client_id, name, url, created_at, updated_at
             FROM workspaces WHERE client_id IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql).expect("prepare batch workspaces");
        let params: Vec<&dyn rusqlite::types::ToSql> = client_ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        stmt.query_map(params.as_slice(), row_to_workspace)
            .expect("query batch workspaces")
            .filter_map(|r| r.ok())
            .collect()
    }
}

fn row_to_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        client_id: row.get(0)?,
        name: row.get(1)?,
        url: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}
