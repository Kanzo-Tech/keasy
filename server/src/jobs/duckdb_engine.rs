//! DuckDB implementation of SqlEngine for the Executor.
//!
//! DuckDB's Connection uses RefCell internally (not Send+Sync).
//! We wrap it in a Mutex for thread safety since the Executor runs
//! in spawn_blocking (single-threaded, but Rust needs Send proof).

use std::sync::Mutex;

use duckdb::Connection;
use fossil_lang::registry::SqlEngine;

/// DuckDB connection wrapper implementing SqlEngine.
///
/// Mutex provides Send+Sync. The executor runs in spawn_blocking
/// so contention is not an issue.
pub struct DuckDbConn {
    conn: Mutex<Connection>,
}

impl DuckDbConn {
    pub fn new() -> Result<Self, duckdb::Error> {
        let conn = Connection::open_in_memory()?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn with_connection(conn: Connection) -> Self {
        Self { conn: Mutex::new(conn) }
    }

    /// Configure cloud credentials for httpfs access (S3, Azure, GCS).
    pub fn configure_cloud(&self, config: &[(String, String)]) -> Result<(), duckdb::Error> {
        let conn = self.conn.lock().expect("duckdb lock poisoned");
        for (key, value) in config {
            conn.execute(&format!("SET {key} = '{value}'"), [])?;
        }
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("duckdb lock poisoned")
    }
}

impl SqlEngine for DuckDbConn {
    type Error = duckdb::Error;

    fn execute_batch(&self, sql: &str) -> Result<(), Self::Error> {
        self.lock().execute_batch(sql)
    }

    fn query_rows(&self, sql: &str) -> Result<Vec<Vec<String>>, Self::Error> {
        let conn = self.lock();
        let mut stmt = conn.prepare(sql)?;
        let column_count = stmt.column_count();
        let rows = stmt.query_map([], |row| {
            let mut values = Vec::with_capacity(column_count);
            for i in 0..column_count {
                let val: String = row.get::<_, String>(i).unwrap_or_default();
                values.push(val);
            }
            Ok(values)
        })?;
        rows.collect()
    }

    fn insert_batch(
        &self,
        table: &str,
        columns: &[&str],
        rows: &[Vec<String>],
    ) -> Result<(), Self::Error> {
        if rows.is_empty() {
            return Ok(());
        }
        let conn = self.lock();
        let cols = columns.join(", ");
        let placeholder_row: String = (0..columns.len())
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("INSERT INTO {table} ({cols}) VALUES ({placeholder_row})");
        let mut stmt = conn.prepare(&sql)?;
        for row in rows {
            let params: Vec<&dyn duckdb::types::ToSql> = row
                .iter()
                .map(|v| v as &dyn duckdb::types::ToSql)
                .collect();
            stmt.execute(params.as_slice())?;
        }
        Ok(())
    }
}
