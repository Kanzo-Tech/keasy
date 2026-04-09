//! DuckDB connection wrapper for the Executor.

use std::sync::Mutex;

use duckdb::Connection;

/// DuckDB connection wrapper (Mutex for Send+Sync in spawn_blocking).
pub struct DuckDbConn {
    conn: Mutex<Connection>,
}

impl DuckDbConn {
    pub fn new() -> Result<Self, duckdb::Error> {
        let conn = Connection::open_in_memory()?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn with_connection(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }

    /// Known DuckDB settings that may be configured for cloud access.
    const ALLOWED_SETTINGS: &[&str] = &[
        "s3_region",
        "s3_access_key_id",
        "s3_secret_access_key",
        "s3_endpoint",
        "s3_url_style",
        "azure_storage_connection_string",
        "azure_account_name",
        "azure_account_key",
    ];

    pub fn configure_cloud(&self, config: &[(String, String)]) -> Result<(), duckdb::Error> {
        let conn = self.lock();
        for (key, value) in config {
            if !Self::ALLOWED_SETTINGS.contains(&key.as_str()) {
                continue;
            }
            let escaped = value.replace('\'', "''");
            conn.execute(&format!("SET {key} = '{escaped}'"), [])?;
        }
        Ok(())
    }

    pub fn execute_batch(&self, sql: &str) -> Result<(), duckdb::Error> {
        self.lock().execute_batch(sql)
    }

    pub fn query_rows(&self, sql: &str) -> Result<Vec<Vec<String>>, duckdb::Error> {
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

    pub fn insert_batch(
        &self,
        table: &str,
        columns: &[&str],
        rows: &[Vec<String>],
    ) -> Result<(), duckdb::Error> {
        if rows.is_empty() {
            return Ok(());
        }
        let conn = self.lock();
        let cols = columns.join(", ");
        let placeholder_row: String = (0..columns.len())
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("INSERT INTO \"{table}\" ({cols}) VALUES ({placeholder_row})");
        conn.execute_batch("BEGIN TRANSACTION")?;
        let mut stmt = conn.prepare(&sql)?;
        for row in rows {
            let params: Vec<&dyn duckdb::types::ToSql> = row
                .iter()
                .map(|v| v as &dyn duckdb::types::ToSql)
                .collect();
            stmt.execute(params.as_slice())?;
        }
        conn.execute_batch("COMMIT")?;
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("duckdb lock poisoned")
    }
}
