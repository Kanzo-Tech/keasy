use std::path::Path;

use rusqlite::Connection;

/// Execute an external SQL seed file against the database.
/// The file should use `INSERT OR IGNORE` for idempotency.
pub fn load_seed_file(conn: &Connection, path: &Path) -> Result<(), String> {
    let sql = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read seed file {}: {e}", path.display()))?;
    conn.execute_batch(&sql)
        .map_err(|e| format!("failed to execute seed file {}: {e}", path.display()))?;
    Ok(())
}
