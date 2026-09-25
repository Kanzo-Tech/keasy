//! The `connections` table. Nothing here holds a secret.

use rusqlite::{Connection, OptionalExtension, params};

use crate::api::connections::ConnectionView;
use crate::api::credentials::Purpose;
use crate::api::validation::ValidationReport;

use crate::database::{DbError, DbResult, constraint, json_column, json_column_opt};

const COLUMNS: &str =
    "name, credential, target, created_by, created_at, updated_by, updated_at, validation";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionView> {
    Ok(ConnectionView {
        name: r.get("name")?,
        credential: r.get("credential")?,
        target: json_column(r, "target")?,
        created_by: r.get("created_by")?,
        created_at: r.get("created_at")?,
        updated_by: r.get("updated_by")?,
        updated_at: r.get("updated_at")?,
        validation: json_column_opt(r, "validation")?,
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
            "there is no {} credential named {:?}",
            connection.target.purpose().as_ref(),
            connection.credential
        )),
        Some(ffi::SQLITE_CONSTRAINT_CHECK) => {
            DbError::Invalid("the target does not match its purpose".into())
        }
        _ => e.into(),
    }
}

/// Store `connection` as it stands; its timestamps are the store's.
pub fn insert(conn: &Connection, connection: &ConnectionView, by: &str) -> DbResult<()> {
    conn.execute(
        &format!(
            "INSERT INTO connections (purpose, {COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?6, ?7)"
        ),
        params![
            connection.target.purpose().as_ref(),
            connection.name,
            connection.credential,
            serde_json::to_string(&connection.target)?,
            by,
            crate::jobs::now_iso8601(),
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

/// Every connection of `purpose`, all of them without one.
pub fn list(conn: &Connection, purpose: Option<Purpose>) -> DbResult<Vec<ConnectionView>> {
    let connections = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM connections WHERE ?1 IS NULL OR purpose = ?1 ORDER BY name"
        ))?
        .query_map([purpose.as_ref().map(AsRef::as_ref)], row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(connections)
}

/// The connections that sign or call with `credential`.
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
pub fn update(conn: &Connection, name: &str, updated: &ConnectionView, by: &str) -> DbResult<()> {
    conn.execute(
        "UPDATE connections
         SET name = ?1, purpose = ?2, credential = ?3, target = ?4,
             updated_by = ?5, updated_at = ?6, validation = ?7
         WHERE name = ?8",
        params![
            updated.name,
            updated.target.purpose().as_ref(),
            updated.credential,
            serde_json::to_string(&updated.target)?,
            by,
            crate::jobs::now_iso8601(),
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
    use crate::api::connections::ConnectionTarget;
    use crate::api::connections::{ModelTarget, StorageTarget};
    use crate::api::credentials::{CredentialSpecInput, ModelCredentialInput};
    use crate::credentials::persistence as credentials;
    use crate::credentials::sealing::SecretKey;
    use crate::domain::ResourceName;
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
        let spec =
            CredentialSpecInput::Storage(crate::api::credentials::StorageCredentialInput::S3 {
                access_key_id: "AK".into(),
                secret_access_key: SecretString::from("SK"),
                region: "us-east-1".into(),
                endpoint: None,
            });
        let credential = format!("{name}-key");
        credentials::insert(
            conn,
            &SecretKey::for_tests(),
            &ResourceName::parse(&credential).unwrap(),
            &spec,
            "u-1",
            &report(),
        )
        .unwrap();
        let target = ConnectionTarget::Storage(StorageTarget {
            url: "s3://b/output/".into(),
            kind: Default::default(),
            direction: crate::api::connections::Direction::Sink,
        });
        insert(conn, &connection(name, &credential, target), "u-1").unwrap();
    }

    fn connection(name: &str, credential: &str, target: ConnectionTarget) -> ConnectionView {
        ConnectionView {
            name: name.into(),
            credential: credential.into(),
            target,
            created_by: String::new(),
            created_at: String::new(),
            updated_by: String::new(),
            updated_at: String::new(),
            validation: None,
        }
    }

    /// The database itself keeps a storage connection off a model credential,
    /// whatever a handler checked first, and keeps a used credential.
    #[test]
    fn a_connection_cannot_reference_a_credential_of_the_other_purpose() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        let key = CredentialSpecInput::Model(ModelCredentialInput::Anthropic {
            api_key: SecretString::from("sk-ant"),
        });
        let claude = ResourceName::parse("claude").unwrap();
        credentials::insert(
            &conn,
            &SecretKey::for_tests(),
            &claude,
            &key,
            "u-1",
            &report(),
        )
        .unwrap();

        let bucket = ConnectionTarget::Storage(StorageTarget {
            url: "s3://b/".into(),
            kind: Default::default(),
            direction: Default::default(),
        });
        let err = insert(&conn, &connection("bucket", "claude", bucket), "u-1").unwrap_err();
        assert!(matches!(err, DbError::Invalid(_)), "{err}");

        let model = ConnectionTarget::Model(ModelTarget {
            model: None,
            max_tokens: None,
        });
        insert(&conn, &connection("fast", "claude", model), "u-1").unwrap();
        assert!(matches!(
            credentials::delete(&conn, "claude"),
            Err(DbError::InUse { dependents, .. }) if dependents == ["fast"]
        ));
        let bypass = conn.execute("DELETE FROM credentials WHERE name = 'claude'", []);
        assert!(bypass.is_err(), "the foreign key restricts the delete");
    }
}
