use rusqlite::params;

use super::Database;

#[derive(Debug, Clone)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub legal_name: String,
    pub registration_number: Option<String>,
    pub country: String,
    pub vc_verified_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Database {
    pub async fn create_organization(&self, org: &Organization) -> Result<(), String> {
        let conn = self.write().await;
        conn.execute(
            "INSERT INTO organizations
             (id, name, legal_name, registration_number, country, vc_verified_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                org.id,
                org.name,
                org.legal_name,
                org.registration_number,
                org.country,
                org.vc_verified_at,
                org.created_at,
                org.updated_at,
            ],
        )
        .map_err(|e| format!("failed to insert organization: {e}"))?;
        Ok(())
    }

    pub async fn get_organization(&self, id: &str) -> Option<Organization> {
        let (_permit, conn) = self.read().await;
        conn.query_row(
            "SELECT id, name, legal_name, registration_number, country, vc_verified_at, created_at, updated_at
             FROM organizations WHERE id = ?1",
            [id],
            row_to_org,
        )
        .ok()
    }

    pub async fn list_organizations(&self) -> Vec<Organization> {
        let (_permit, conn) = self.read().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, legal_name, registration_number, country, vc_verified_at, created_at, updated_at
                 FROM organizations ORDER BY name",
            )
            .expect("prepare list organizations");
        stmt.query_map([], row_to_org)
            .expect("query organizations")
            .filter_map(|r| r.ok())
            .collect()
    }
}

fn row_to_org(row: &rusqlite::Row<'_>) -> rusqlite::Result<Organization> {
    Ok(Organization {
        id: row.get(0)?,
        name: row.get(1)?,
        legal_name: row.get(2)?,
        registration_number: row.get(3)?,
        country: row.get(4)?,
        vc_verified_at: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}
