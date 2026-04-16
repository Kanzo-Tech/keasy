//! DuckDB connection wrapper for the Executor.

use std::sync::Mutex;

use duckdb::Connection;

use crate::connectors::types::DuckDbSecretSpec;

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

    /// Load DuckDB extensions (e.g. `httpfs`, `azure`). Idempotent.
    /// Required before any cloud read or `CREATE SECRET (TYPE s3|azure|gcs)`.
    /// `gcs` is served by the `httpfs` extension (S3-compatible interop).
    pub fn load_extensions(&self, exts: &[&str]) -> Result<(), duckdb::Error> {
        let conn = self.lock();
        for ext in exts {
            conn.execute_batch(&format!("INSTALL {ext}; LOAD {ext};"))?;
        }
        Ok(())
    }

    /// Install a DuckDB SECRET scoped to a URL prefix. DuckDB autoselects
    /// the matching secret per cloud read by SCOPE prefix, so multiple
    /// connectors with distinct credentials coexist without collisions.
    ///
    /// Reference: <https://duckdb.org/docs/configuration/secrets_manager>
    pub fn install_secret(
        &self,
        name: &str,
        scope: &str,
        spec: &DuckDbSecretSpec,
    ) -> Result<(), duckdb::Error> {
        let safe_name = sanitize_secret_name(name);
        let safe_scope = scope.replace('\'', "''");
        let mut sql = format!(
            "CREATE OR REPLACE SECRET \"{safe_name}\" (TYPE {ty}, SCOPE '{safe_scope}'",
            ty = spec.secret_type,
        );
        for (key, value) in &spec.params {
            let escaped = value.replace('\'', "''");
            sql.push_str(&format!(", {key} '{escaped}'"));
        }
        sql.push(')');
        self.lock().execute_batch(&sql)
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

/// Coerce a connector name into a SQL identifier safe to interpolate
/// inside `CREATE SECRET "<name>"`. Replaces non-alphanumeric chars with
/// `_` and prefixes `conn_` to avoid colliding with reserved names or
/// starting with a digit.
fn sanitize_secret_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("conn_{cleaned}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_secret_quotes_single_quotes() {
        let conn = DuckDbConn::new().expect("duckdb in-memory");
        conn.load_extensions(&["httpfs"]).expect("load httpfs");
        let spec = DuckDbSecretSpec {
            secret_type: "s3",
            params: vec![
                ("KEY_ID", "ab'cd".to_string()),
                ("SECRET", "ef".to_string()),
                ("REGION", "eu-west-1".to_string()),
            ],
        };
        conn.install_secret("dev-bucket", "s3://it's-a-bucket/", &spec)
            .expect("install secret");
    }

    #[test]
    fn sanitize_secret_name_handles_dashes_and_dots() {
        assert_eq!(sanitize_secret_name("dev-bucket.v2"), "conn_dev_bucket_v2");
        assert_eq!(sanitize_secret_name("plain"), "conn_plain");
    }

    #[test]
    fn load_extensions_is_idempotent() {
        let conn = DuckDbConn::new().expect("duckdb in-memory");
        conn.load_extensions(&["httpfs"]).expect("load httpfs once");
        conn.load_extensions(&["httpfs"]).expect("load httpfs twice");
    }
}
