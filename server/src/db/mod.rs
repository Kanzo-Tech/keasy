pub mod diesel_schema;
mod schema;
pub mod secrets;
pub mod seed;

use std::path::Path;

use deadpool_diesel::sqlite::{Manager, Pool as DieselPool, Runtime};
use deadpool_diesel::{ManagerConfig, RecyclingMethod};
use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use secrecy::SecretString;

pub type DbPool = DieselPool;

fn create_diesel_pool(db_path: &str) -> DbPool {
    let manager = Manager::from_config(
        db_path,
        Runtime::Tokio1,
        ManagerConfig {
            // Run PRAGMAs on every connection (create + recycle).
            // journal_mode=WAL persists in the DB file, but foreign_keys and
            // busy_timeout are per-connection SQLite defaults that must be set explicitly.
            recycling_method: RecyclingMethod::CustomFunction(Box::new(|conn| {
                conn.batch_execute("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")?;
                Ok(())
            })),
        },
    );
    DieselPool::builder(manager)
        .max_size(8)
        .build()
        .expect("Failed to create Diesel pool")
}

#[derive(Clone)]
pub struct Repos {
    pub diesel_pool: DbPool,
    secret_key: Option<SecretString>,
}

impl Repos {
    pub fn open(path: &Path, secret_key: Option<SecretString>, seed_file: Option<&Path>) -> Result<Self, String> {
        let db_path = path.to_str().ok_or("non-UTF8 database path")?;

        // One-shot Diesel connection for schema + seed init (outside async runtime)
        let mut init_conn = SqliteConnection::establish(db_path)
            .map_err(|e| format!("failed to open init connection: {e}"))?;
        init_conn
            .batch_execute("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
            .map_err(|e| format!("init pragmas: {e}"))?;
        schema::apply(&mut init_conn)?;
        if let Some(sf) = seed_file {
            seed::load_seed_file(&mut init_conn, sf)?;
        }
        drop(init_conn);

        // Production connection pool
        let diesel_pool = create_diesel_pool(db_path);

        Ok(Self {
            diesel_pool,
            secret_key,
        })
    }
}
