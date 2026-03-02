pub mod invite_tokens;
pub mod oidc_clients;
pub mod organizations;
mod schema;
pub mod secrets;
pub mod seed;
pub mod users;

use std::path::Path;
use std::sync::Arc;

use rusqlite::Connection;
use secrecy::SecretString;
use tokio::sync::{Mutex, Semaphore};

const READ_POOL_SIZE: usize = 4;

struct ReadPool {
    conns: Vec<Mutex<Connection>>,
    semaphore: Semaphore,
}

impl ReadPool {
    fn new(conns: Vec<Connection>) -> Self {
        let n = conns.len();
        Self {
            conns: conns.into_iter().map(Mutex::new).collect(),
            semaphore: Semaphore::new(n),
        }
    }

    /// Acquire a semaphore permit and return an unlocked read connection.
    /// Because the semaphore count equals the pool size, one will always be
    /// immediately available after acquiring the permit.
    async fn acquire(
        &self,
    ) -> (
        tokio::sync::SemaphorePermit<'_>,
        tokio::sync::MutexGuard<'_, Connection>,
    ) {
        let permit = self.semaphore.acquire().await.expect("semaphore closed");
        for conn in &self.conns {
            if let Ok(guard) = conn.try_lock() {
                return (permit, guard);
            }
        }
        // Should never reach here — semaphore ensures a slot is free
        unreachable!("semaphore permits exceed pool size")
    }
}

#[derive(Clone)]
pub struct Database {
    write_conn: Arc<Mutex<Connection>>,
    read_pool: Arc<ReadPool>,
    secret_key: Option<SecretString>,
}

impl Database {
    pub fn open(path: &Path, secret_key: Option<SecretString>, seed_file: Option<&Path>) -> Result<Self, String> {
        // Open write connection
        let write_conn = open_conn(path)?;
        write_conn
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
            )
            .map_err(|e| format!("write conn pragmas: {e}"))?;
        schema::apply(&write_conn)?;
        if let Some(sf) = seed_file {
            seed::load_seed_file(&write_conn, sf)?;
        }

        // Open read pool connections
        let read_conns: Result<Vec<_>, _> = (0..READ_POOL_SIZE).map(|_| open_conn(path)).collect();
        let read_conns = read_conns?;
        for rc in &read_conns {
            rc.execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA query_only=ON;",
            )
            .map_err(|e| format!("read conn pragmas: {e}"))?;
        }

        Ok(Self {
            write_conn: Arc::new(Mutex::new(write_conn)),
            read_pool: Arc::new(ReadPool::new(read_conns)),
            secret_key,
        })
    }

    /// Acquire the write connection lock.
    pub async fn write(&self) -> tokio::sync::MutexGuard<'_, Connection> {
        self.write_conn.lock().await
    }

    /// Acquire a read connection from the pool.
    pub async fn read(
        &self,
    ) -> (
        tokio::sync::SemaphorePermit<'_>,
        tokio::sync::MutexGuard<'_, Connection>,
    ) {
        self.read_pool.acquire().await
    }
}

fn open_conn(path: &Path) -> Result<Connection, String> {
    Connection::open(path).map_err(|e| format!("failed to open connection: {e}"))
}
