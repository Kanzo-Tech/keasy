use rusqlite::params;

use super::Database;

#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
pub struct OidcClient {
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
    pub async fn create_oidc_client(&self, client: &OidcClient) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO oidc_clients
             (id, client_id, name, url, description, logo, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                client.id,
                client.client_id,
                client.name,
                client.url,
                client.description,
                client.logo,
                client.created_at,
                client.updated_at,
            ],
        )
        .map_err(|e| format!("failed to insert oidc_client: {e}"))?;
        Ok(())
    }

    pub async fn get_oidc_client(&self, id: &str) -> Option<OidcClient> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, client_id, name, url, description, logo, created_at, updated_at
             FROM oidc_clients WHERE id = ?1",
            [id],
            row_to_oidc_client,
        )
        .ok()
    }

    pub async fn get_oidc_client_by_client_id(&self, client_id: &str) -> Option<OidcClient> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, client_id, name, url, description, logo, created_at, updated_at
             FROM oidc_clients WHERE client_id = ?1",
            [client_id],
            row_to_oidc_client,
        )
        .ok()
    }

    pub async fn list_oidc_clients(&self) -> Vec<OidcClient> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, client_id, name, url, description, logo, created_at, updated_at
                 FROM oidc_clients ORDER BY name",
            )
            .expect("prepare list oidc_clients");
        stmt.query_map([], row_to_oidc_client)
            .expect("query oidc_clients")
            .filter_map(|r| r.ok())
            .collect()
    }
}

fn row_to_oidc_client(row: &rusqlite::Row<'_>) -> rusqlite::Result<OidcClient> {
    Ok(OidcClient {
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
