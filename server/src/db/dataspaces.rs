use rusqlite::params;

use super::Database;

#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct Dataspace {
    pub id: String,
    pub client_id: String,
    pub name: String,
    pub url: String,
    pub description: Option<String>,
    pub logo: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    /// Idempotent upsert — registers a dataspace if it doesn't exist yet (by client_id).
    /// Used at startup to self-register and register federation peers.
    pub async fn ensure_dataspace(
        &self,
        client_id: &str,
        name: &str,
        url: &str,
    ) -> Result<(), String> {
        let conn = self.write().await;
        let now = jiff::Timestamp::now().to_string();
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO dataspaces (id, client_id, name, url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(client_id) DO UPDATE SET name = ?3, url = ?4, updated_at = ?5",
            params![id, client_id, name, url, now],
        )
        .map_err(|e| format!("ensure_dataspace: {e}"))?;
        Ok(())
    }

    pub async fn create_dataspace(&self, ds: &Dataspace) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO dataspaces
             (id, client_id, name, url, description, logo, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                ds.id,
                ds.client_id,
                ds.name,
                ds.url,
                ds.description,
                ds.logo,
                ds.created_at,
                ds.updated_at,
            ],
        )
        .map_err(|e| format!("failed to insert dataspace: {e}"))?;
        Ok(())
    }

    pub async fn get_dataspace(&self, id: &str) -> Option<Dataspace> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, client_id, name, url, description, logo, created_at, updated_at
             FROM dataspaces WHERE id = ?1",
            [id],
            row_to_dataspace,
        )
        .ok()
    }

    pub async fn get_dataspace_by_client_id(&self, client_id: &str) -> Option<Dataspace> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, client_id, name, url, description, logo, created_at, updated_at
             FROM dataspaces WHERE client_id = ?1",
            [client_id],
            row_to_dataspace,
        )
        .ok()
    }

    /// Batch lookup: returns all dataspaces whose client_id is in the given list.
    pub async fn get_dataspaces_by_client_ids(&self, client_ids: &[&str]) -> Vec<Dataspace> {
        if client_ids.is_empty() {
            return Vec::new();
        }
        let (_permit, conn) = self.read().await;
        let placeholders: Vec<String> = (1..=client_ids.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT id, client_id, name, url, description, logo, created_at, updated_at
             FROM dataspaces WHERE client_id IN ({})",
            placeholders.join(", ")
        );
        let mut stmt = conn.prepare(&sql).expect("prepare batch dataspaces");
        let params: Vec<&dyn rusqlite::types::ToSql> = client_ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        stmt.query_map(params.as_slice(), row_to_dataspace)
            .expect("query batch dataspaces")
            .filter_map(|r| r.ok())
            .collect()
    }

    pub async fn list_dataspaces(&self) -> Vec<Dataspace> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, client_id, name, url, description, logo, created_at, updated_at
                 FROM dataspaces ORDER BY name",
            )
            .expect("prepare list dataspaces");
        stmt.query_map([], row_to_dataspace)
            .expect("query dataspaces")
            .filter_map(|r| r.ok())
            .collect()
    }
}

fn row_to_dataspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<Dataspace> {
    Ok(Dataspace {
        id: row.get(0)?,
        client_id: row.get(1)?,
        name: row.get(2)?,
        url: row.get(3)?,
        description: row.get(4)?,
        logo: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}
