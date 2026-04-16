//! Diesel-backed session store for tower-sessions.
//!
//! Replaces `tower-sessions-rusqlite-store` — sessions share the existing Diesel
//! pool instead of maintaining a separate rusqlite connection.

use async_trait::async_trait;
use deadpool_diesel::sqlite::Pool;
use diesel::prelude::*;
use tower_sessions_core::session::{Id, Record};
use tower_sessions_core::session_store;
use tower_sessions_core::{ExpiredDeletion, SessionStore};

use crate::db::diesel_schema::tower_sessions::dsl;

fn backend(e: impl std::fmt::Display) -> session_store::Error {
    session_store::Error::Backend(e.to_string())
}

#[derive(Clone)]
pub struct DieselStore {
    pool: Pool,
}

impl std::fmt::Debug for DieselStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DieselStore").finish()
    }
}

impl DieselStore {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }
}

#[derive(Insertable, AsChangeset)]
#[diesel(table_name = crate::db::diesel_schema::tower_sessions)]
struct SessionRecord {
    id: String,
    data: Vec<u8>,
    expiry_date: i64,
}

#[derive(Queryable, Selectable)]
#[diesel(table_name = crate::db::diesel_schema::tower_sessions)]
struct SessionRow {
    data: Vec<u8>,
}

#[async_trait]
impl SessionStore for DieselStore {
    async fn save(&self, record: &Record) -> session_store::Result<()> {
        let row = SessionRecord {
            id: record.id.to_string(),
            data: rmp_serde::to_vec(record)
                .map_err(|e| session_store::Error::Encode(e.to_string()))?,
            expiry_date: record.expiry_date.unix_timestamp(),
        };

        self.pool.get().await.map_err(backend)?
            .interact(move |conn| {
                diesel::insert_into(dsl::tower_sessions)
                    .values(&row)
                    .on_conflict(dsl::id)
                    .do_update()
                    .set(&row)
                    .execute(conn)
            })
            .await.map_err(backend)?.map_err(backend)?;

        Ok(())
    }

    async fn load(&self, session_id: &Id) -> session_store::Result<Option<Record>> {
        let id = session_id.to_string();
        let now = time::OffsetDateTime::now_utc().unix_timestamp();

        let row = self.pool.get().await.map_err(backend)?
            .interact(move |conn| {
                dsl::tower_sessions
                    .filter(dsl::id.eq(&id).and(dsl::expiry_date.gt(now)))
                    .select(SessionRow::as_select())
                    .first::<SessionRow>(conn)
                    .optional()
            })
            .await.map_err(backend)?.map_err(backend)?;

        match row {
            Some(row) => {
                let record: Record = rmp_serde::from_slice(&row.data)
                    .map_err(|e| session_store::Error::Decode(e.to_string()))?;
                Ok(Some(record))
            }
            None => Ok(None),
        }
    }

    async fn delete(&self, session_id: &Id) -> session_store::Result<()> {
        let id = session_id.to_string();

        self.pool.get().await.map_err(backend)?
            .interact(move |conn| {
                diesel::delete(dsl::tower_sessions.filter(dsl::id.eq(&id)))
                    .execute(conn)
            })
            .await.map_err(backend)?.map_err(backend)?;

        Ok(())
    }
}

#[async_trait]
impl ExpiredDeletion for DieselStore {
    async fn delete_expired(&self) -> session_store::Result<()> {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();

        self.pool.get().await.map_err(backend)?
            .interact(move |conn| {
                diesel::delete(dsl::tower_sessions.filter(dsl::expiry_date.le(now)))
                    .execute(conn)
            })
            .await.map_err(backend)?.map_err(backend)?;

        Ok(())
    }
}
