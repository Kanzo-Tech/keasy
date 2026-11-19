//! The `connections` table: a name and a location, and nothing that opens it.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{
    DbError, DbResult, constraint, json_column, json_column_opt, owner_columns, provenance_columns,
};
use crate::domain::{Actor, ConnectionView, ValidationReport};

const COLUMNS: &str = "name, target, owner, owner_name, created_by, \
                       created_by_name, created_at, updated_by, updated_by_name, updated_at, \
                       validation";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionView> {
    Ok(ConnectionView {
        name: r.get("name")?,
        target: json_column(r, "target")?,
        owner: owner_columns(r)?,
        provenance: provenance_columns(r)?,
        validation: json_column_opt(r, "validation")?,
        can: Default::default(),
    })
}

/// A write the schema refused is the caller's to fix, not a failure of the store.
fn refused(connection: &ConnectionView, e: rusqlite::Error) -> DbError {
    use rusqlite::ffi;
    match constraint(&e) {
        Some(ffi::SQLITE_CONSTRAINT_PRIMARYKEY) => DbError::AlreadyExists(format!(
            "a connection named {:?} exists already",
            connection.name
        )),
        Some(ffi::SQLITE_CONSTRAINT_UNIQUE) => {
            DbError::AlreadyExists("the workspace has a sink already".into())
        }
        _ => e.into(),
    }
}

/// Store `connection` as it stands, created by `by` and owned as
/// [`Actor::as_owner`] says; its timestamps are the store's.
pub fn insert(conn: &Connection, connection: &ConnectionView, by: &Actor) -> DbResult<()> {
    let owner = by.as_owner();
    conn.execute(
        "INSERT INTO connections
             (name, target, owner, owner_name, created_by, created_by_name,
              created_at, validation)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            connection.name,
            serde_json::to_string(&connection.target)?,
            owner.id,
            owner.name,
            by.id,
            by.name,
            crate::domain::now_iso8601(),
            connection
                .validation
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?
        ],
    )
    .map_err(|e| refused(connection, e))?;
    Ok(())
}

pub fn get(conn: &Connection, name: &str) -> DbResult<Option<ConnectionView>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM connections WHERE name = ?1"),
            [name],
            row,
        )
        .optional()?)
}

/// The workspace's one sink, if it has one.
pub fn sink(conn: &Connection) -> DbResult<Option<ConnectionView>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM connections WHERE direction = 'sink'"),
            [],
            row,
        )
        .optional()?)
}

/// Every connection.
pub fn list(conn: &Connection) -> DbResult<Vec<ConnectionView>> {
    let connections = conn
        .prepare(&format!("SELECT {COLUMNS} FROM connections ORDER BY name"))?
        .query_map([], row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(connections)
}

/// Replace the connection `name` with `updated`. A rename cascades to the graphs
/// that write to it.
pub fn update(conn: &Connection, name: &str, updated: &ConnectionView, by: &Actor) -> DbResult<()> {
    conn.execute(
        "UPDATE connections
         SET name = ?1, target = ?2,
             updated_by = ?3, updated_by_name = ?4, updated_at = ?5, validation = ?6
         WHERE name = ?7",
        params![
            updated.name,
            serde_json::to_string(&updated.target)?,
            by.id,
            by.name,
            crate::domain::now_iso8601(),
            updated
                .validation
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            name
        ],
    )
    .map_err(|e| refused(updated, e))?;
    Ok(())
}

pub fn set_validation(conn: &Connection, name: &str, report: &ValidationReport) -> DbResult<()> {
    conn.execute(
        "UPDATE connections SET validation = ?1 WHERE name = ?2",
        params![serde_json::to_string(report)?, name],
    )?;
    Ok(())
}

/// Delete a connection no graph writes to. The sink of existing graphs is refused,
/// naming the graphs; the foreign key refuses it too.
pub fn delete(conn: &Connection, name: &str) -> DbResult<()> {
    let graphs: Vec<String> = conn
        .prepare("SELECT id FROM graphs WHERE sink_connection = ?1 ORDER BY created_at")?
        .query_map([name], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    if !graphs.is_empty() {
        return Err(DbError::InUse {
            message: format!(
                "{} graph(s) wrote their output to {name:?}; delete them first",
                graphs.len()
            ),
            dependents: graphs,
        });
    }
    conn.execute("DELETE FROM connections WHERE name = ?1", [name])
        .map_err(|e| match constraint(&e) {
            Some(rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY) => DbError::InUse {
                message: format!("connection {name:?} is in use"),
                dependents: Vec::new(),
            },
            _ => e.into(),
        })?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::domain::{Provenance, StorageTarget};

    /// A sink connection `name`, stored as it is: a fixture nobody probes.
    pub(crate) fn seed_sink(conn: &Connection, name: &str) {
        let target = StorageTarget {
            url: "s3://b/output/".into(),
            direction: crate::domain::Direction::Sink,
        };
        insert(conn, &connection(name, target), &user()).unwrap();
    }

    fn connection(name: &str, target: StorageTarget) -> ConnectionView {
        ConnectionView {
            name: name.into(),
            target,
            owner: user(),
            provenance: Provenance::created(user()),
            validation: None,
            can: Default::default(),
        }
    }

    pub(crate) fn user() -> Actor {
        Actor {
            id: "u-1".into(),
            name: "Ana Duarte".into(),
        }
    }

    /// The schema keeps one sink, whatever a handler checked first.
    #[test]
    fn a_workspace_has_one_sink() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        seed_sink(&conn, "out");
        let second = StorageTarget {
            url: "s3://b/elsewhere/".into(),
            direction: crate::domain::Direction::Sink,
        };
        let err = insert(&conn, &connection("out2", second), &user()).unwrap_err();
        assert!(matches!(err, DbError::AlreadyExists(_)), "{err}");
    }
}
