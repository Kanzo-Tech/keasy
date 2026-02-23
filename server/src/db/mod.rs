pub mod cloud_accounts;
pub mod conversations;
pub mod jobs;
mod schema;
pub mod secrets;
pub mod settings;
pub mod connections;

use std::path::Path;
use std::sync::Arc;

use rusqlite::Connection;
use secrecy::SecretString;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
    secret_key: Option<SecretString>,
}

impl Database {
    pub fn open(path: &Path, secret_key: Option<SecretString>) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("failed to open database: {e}"))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("failed to set pragmas: {e}"))?;
        schema::migrate(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            secret_key,
        })
    }
}
