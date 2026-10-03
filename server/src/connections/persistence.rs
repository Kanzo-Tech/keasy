//! The `connections` table. Nothing here holds a secret.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{
    DbError, DbResult, constraint, json_column, json_column_opt, provenance_columns,
};
use crate::domain::{Actor, ConnectionView, ValidationReport};

const COLUMNS: &str = "name, credential, target, created_by, created_by_name, created_at, \
                       updated_by, updated_by_name, updated_at, validation";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionView> {
    Ok(ConnectionView {
        name: r.get("name")?,
        secret: r.get("credential")?,
        target: json_column(r, "target")?,
        provenance: provenance_columns(r)?,
        validation: json_column_opt(r, "validation")?,
        can_modify: false,
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
        Some(ffi::SQLITE_CONSTRAINT_FOREIGNKEY) => DbError::Invalid(format!(
            "there is no credential named {:?}",
            connection.secret
        )),
        _ => e.into(),
    }
}

/// Store `connection` as it stands, created by `by`; its timestamps are the store's.
pub fn insert(conn: &Connection, connection: &ConnectionView, by: &Actor) -> DbResult<()> {
    conn.execute(
        "INSERT INTO connections
             (name, credential, target, created_by, created_by_name, created_at, validation)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            connection.name,
            connection.secret,
            serde_json::to_string(&connection.target)?,
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

/// The connections that sign with `credential`.
pub fn using(conn: &Connection, credential: &str) -> DbResult<Vec<ConnectionView>> {
    let connections = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM connections WHERE credential = ?1 ORDER BY name"
        ))?
        .query_map([credential], row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(connections)
}

/// Replace the connection `name` with `updated`. A rename cascades to the jobs
/// that write to it.
pub fn update(conn: &Connection, name: &str, updated: &ConnectionView, by: &Actor) -> DbResult<()> {
    conn.execute(
        "UPDATE connections
         SET name = ?1, credential = ?2, target = ?3,
             updated_by = ?4, updated_by_name = ?5, updated_at = ?6, validation = ?7
         WHERE name = ?8",
        params![
            updated.name,
            updated.secret,
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

/// Delete a connection no job writes to. The sink of existing jobs is refused,
/// naming the jobs; the foreign key refuses it too.
pub fn delete(conn: &Connection, name: &str) -> DbResult<()> {
    let jobs: Vec<String> = conn
        .prepare("SELECT id FROM jobs WHERE sink_connection = ?1 ORDER BY created_at")?
        .query_map([name], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    if !jobs.is_empty() {
        return Err(DbError::InUse {
            message: format!(
                "{} job(s) wrote their output to {name:?}; delete them first",
                jobs.len()
            ),
            dependents: jobs,
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
    use crate::credentials::persistence as credentials;
    use crate::credentials::sealing::SecretKey;
    use crate::domain::{Provenance, ResourceName, SecretSpec, StorageTarget};
    use secrecy::SecretString;

    fn report() -> ValidationReport {
        ValidationReport {
            at: "now".into(),
            results: Vec::new(),
        }
    }

    /// A storage credential and a sink connection `name` on it, stored as they
    /// are: a fixture nobody probes.
    pub(crate) fn seed_sink(conn: &Connection, name: &str) {
        let spec = s3();
        let credential = format!("{name}-key");
        credentials::insert(
            conn,
            &SecretKey::for_tests(),
            &ResourceName::parse(&credential).unwrap(),
            &spec,
            &user(),
            &report(),
        )
        .unwrap();
        let target = StorageTarget {
            url: "s3://b/output/".into(),
            kind: Default::default(),
            direction: crate::domain::Direction::Sink,
        };
        insert(conn, &connection(name, &credential, target), &user()).unwrap();
    }

    fn connection(name: &str, credential: &str, target: StorageTarget) -> ConnectionView {
        ConnectionView {
            name: name.into(),
            secret: credential.into(),
            target,
            provenance: Provenance::created(user()),
            validation: None,
            can_modify: false,
        }
    }

    pub(crate) fn user() -> Actor {
        Actor {
            id: "u-1".into(),
            name: "Ana Duarte".into(),
        }
    }

    fn s3() -> SecretSpec {
        SecretSpec::S3 {
            access_key_id: "AK".into(),
            secret_access_key: SecretString::from("SK"),
            region: "us-east-1".into(),
            endpoint: None,
            role_arn: None,
            external_id: None,
        }
    }

    /// The database itself keeps a connection on a credential that exists,
    /// whatever a handler checked first, and keeps a used credential.
    #[test]
    fn a_connection_needs_its_credential_and_keeps_it() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        let bucket = || StorageTarget {
            url: "s3://b/".into(),
            kind: Default::default(),
            direction: Default::default(),
        };
        let err = insert(&conn, &connection("bucket", "minio", bucket()), &user()).unwrap_err();
        assert!(matches!(err, DbError::Invalid(_)), "{err}");

        let minio = ResourceName::parse("minio").unwrap();
        credentials::insert(
            &conn,
            &SecretKey::for_tests(),
            &minio,
            &s3(),
            &user(),
            &report(),
        )
        .unwrap();
        insert(&conn, &connection("bucket", "minio", bucket()), &user()).unwrap();
        assert!(matches!(
            credentials::delete(&conn, "minio"),
            Err(DbError::InUse { dependents, .. }) if dependents == ["bucket"]
        ));
        let bypass = conn.execute("DELETE FROM credentials WHERE name = 'minio'", []);
        assert!(bypass.is_err(), "the foreign key restricts the delete");
    }
}
