use diesel::prelude::*;

use crate::db::diesel_schema::dataspaces;
use super::Repos;

#[derive(Debug, Clone, serde::Serialize, Queryable, Selectable, Insertable, utoipa::ToSchema)]
#[diesel(table_name = dataspaces)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
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

use dataspaces::dsl;

impl Repos {
    /// Idempotent upsert — registers a dataspace if it doesn't exist yet (by client_id).
    /// Used at startup to self-register and register federation peers.
    pub async fn ensure_dataspace(
        &self,
        client_id: &str,
        name: &str,
        url: &str,
    ) -> Result<(), String> {
        let now = jiff::Timestamp::now().to_string();
        let id = uuid::Uuid::new_v4().to_string();
        let client_id = client_id.to_string();
        let name = name.to_string();
        let url = url.to_string();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(dsl::dataspaces)
                    .values((
                        dsl::id.eq(&id),
                        dsl::client_id.eq(&client_id),
                        dsl::name.eq(&name),
                        dsl::url.eq(&url),
                        dsl::created_at.eq(&now),
                        dsl::updated_at.eq(&now),
                    ))
                    .on_conflict(dsl::client_id)
                    .do_update()
                    .set((
                        dsl::name.eq(&name),
                        dsl::url.eq(&url),
                        dsl::updated_at.eq(&now),
                    ))
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("ensure_dataspace: {e}"))?;
        Ok(())
    }

    pub async fn create_dataspace(&self, ds: &Dataspace) -> Result<(), String> {
        let ds = ds.clone();
        self.diesel_pool
            .get()
            .await
            .map_err(|e| format!("pool: {e}"))?
            .interact(move |conn| {
                diesel::insert_into(dsl::dataspaces)
                    .values(&ds)
                    .execute(conn)
            })
            .await
            .map_err(|e| format!("interact: {e}"))?
            .map_err(|e| format!("failed to insert dataspace: {e}"))?;
        Ok(())
    }

    pub async fn get_dataspace(&self, id: &str) -> Option<Dataspace> {
        let id = id.to_string();
        self.diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                dsl::dataspaces
                    .filter(dsl::id.eq(&id))
                    .select(Dataspace::as_select())
                    .first::<Dataspace>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    pub async fn get_dataspace_by_client_id(&self, client_id: &str) -> Option<Dataspace> {
        let client_id = client_id.to_string();
        self.diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                dsl::dataspaces
                    .filter(dsl::client_id.eq(&client_id))
                    .select(Dataspace::as_select())
                    .first::<Dataspace>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()?
    }

    /// Batch lookup: returns all dataspaces whose client_id is in the given list.
    pub async fn get_dataspaces_by_client_ids(&self, client_ids: &[&str]) -> Vec<Dataspace> {
        if client_ids.is_empty() {
            return Vec::new();
        }
        let ids: Vec<String> = client_ids.iter().map(|s| s.to_string()).collect();
        let Ok(pc) = self.diesel_pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(move |conn| {
                dsl::dataspaces
                    .filter(dsl::client_id.eq_any(&ids))
                    .select(Dataspace::as_select())
                    .load::<Dataspace>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }

    pub async fn list_dataspaces(&self) -> Vec<Dataspace> {
        let Ok(pc) = self.diesel_pool.get().await else {
            return vec![];
        };
        let result = pc
            .interact(|conn| {
                dsl::dataspaces
                    .order(dsl::name.asc())
                    .select(Dataspace::as_select())
                    .load::<Dataspace>(conn)
            })
            .await;
        match result {
            Ok(Ok(rows)) => rows,
            _ => vec![],
        }
    }
}
