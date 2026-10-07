//! The `credentials` table. Every spec is sealed whole; it is opened only here
//! and never leaves the server as anything but a [`SecretView`].

use rusqlite::{Connection, OptionalExtension, params};

use super::sealing::{self, SecretKey};
use crate::database::{DbError, DbResult, constraint, json_column_opt, provenance_columns};
use crate::domain::{
    Actor, Credential, Provenance, ResourceName, SecretSpec, SecretView, ValidationReport,
};

const COLUMNS: &str = "name, spec, created_by, created_by_name, created_at, \
                       updated_by, updated_by_name, updated_at, validation";

/// A row, still sealed.
struct Row {
    name: String,
    spec: Vec<u8>,
    provenance: Provenance,
    validation: Option<ValidationReport>,
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        name: r.get("name")?,
        spec: r.get("spec")?,
        provenance: provenance_columns(r)?,
        validation: json_column_opt(r, "validation")?,
    })
}

impl Row {
    fn open(self, key: &SecretKey) -> DbResult<Credential> {
        Ok(Credential {
            spec: sealing::open_spec(&self.name, &self.spec, key).map_err(DbError::Secret)?,
            name: self.name,
            provenance: self.provenance,
            validation: self.validation,
        })
    }
}

fn refused(name: &ResourceName, e: rusqlite::Error) -> DbError {
    use rusqlite::ffi;
    match constraint(&e) {
        Some(ffi::SQLITE_CONSTRAINT_PRIMARYKEY | ffi::SQLITE_CONSTRAINT_UNIQUE) => {
            DbError::AlreadyExists(format!(
                "a credential named {:?} exists already",
                name.as_ref()
            ))
        }
        _ => e.into(),
    }
}

pub fn insert(
    conn: &Connection,
    key: &SecretKey,
    name: &ResourceName,
    spec: &SecretSpec,
    by: &Actor,
    validation: &ValidationReport,
) -> DbResult<()> {
    let sealed = sealing::seal_spec(name.as_ref(), spec, key).map_err(DbError::Secret)?;
    conn.execute(
        "INSERT INTO credentials
             (name, spec, created_by, created_by_name, created_at, validation)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            name.as_ref(),
            sealed,
            by.id,
            by.name,
            crate::domain::now_iso8601(),
            serde_json::to_string(validation)?
        ],
    )
    .map_err(|e| refused(name, e))?;
    Ok(())
}

pub fn get(conn: &Connection, key: &SecretKey, name: &str) -> DbResult<Option<Credential>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM credentials WHERE name = ?1"),
        [name],
        row,
    )
    .optional()?
    .map(|r| r.open(key))
    .transpose()
}

/// Every credential, each with the connections that use it.
pub fn list(conn: &Connection, key: &SecretKey) -> DbResult<Vec<SecretView>> {
    let rows = conn
        .prepare(&format!("SELECT {COLUMNS} FROM credentials ORDER BY name"))?
        .query_map([], row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|r| {
            let credential = r.open(key)?;
            let used_by = users_of(conn, &credential.name)?;
            Ok(credential.view(used_by))
        })
        .collect()
}

/// The names of the connections that use `credential`.
pub fn users_of(conn: &Connection, credential: &str) -> DbResult<Vec<String>> {
    let names = conn
        .prepare("SELECT name FROM connections WHERE credential = ?1 ORDER BY name")?
        .query_map([credential], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(names)
}

/// Rename and/or replace the spec in one statement: a rename cascades to every
/// connection, and the spec is sealed again under the new name. `validation`
/// replaces the stored report when given.
pub fn update(
    conn: &Connection,
    key: &SecretKey,
    name: &str,
    new_name: &ResourceName,
    spec: &SecretSpec,
    by: &Actor,
    validation: Option<&ValidationReport>,
) -> DbResult<()> {
    let sealed = sealing::seal_spec(new_name.as_ref(), spec, key).map_err(DbError::Secret)?;
    conn.execute(
        "UPDATE credentials
         SET name = ?1, spec = ?2, updated_by = ?3, updated_by_name = ?4, updated_at = ?5,
             validation = coalesce(?6, validation)
         WHERE name = ?7",
        params![
            new_name.as_ref(),
            sealed,
            by.id,
            by.name,
            crate::domain::now_iso8601(),
            validation.map(serde_json::to_string).transpose()?,
            name
        ],
    )
    .map_err(|e| refused(new_name, e))?;
    Ok(())
}

pub fn set_validation(conn: &Connection, name: &str, report: &ValidationReport) -> DbResult<()> {
    conn.execute(
        "UPDATE credentials SET validation = ?1 WHERE name = ?2",
        params![serde_json::to_string(report)?, name],
    )?;
    Ok(())
}

/// Delete an unused credential. One a connection still uses is refused, naming
/// the connections; the foreign key refuses it too.
pub fn delete(conn: &Connection, name: &str) -> DbResult<()> {
    let dependents = users_of(conn, name)?;
    if !dependents.is_empty() {
        return Err(DbError::InUse {
            message: format!(
                "credential {name:?} is used by {}; delete or repoint them first",
                dependents.join(", ")
            ),
            dependents,
        });
    }
    conn.execute("DELETE FROM credentials WHERE name = ?1", [name])
        .map_err(|e| match constraint(&e) {
            Some(rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY) => DbError::InUse {
                message: format!("credential {name:?} is in use"),
                dependents: Vec::new(),
            },
            _ => e.into(),
        })?;
    Ok(())
}

/// Whether `key` opens what is stored. True when nothing is.
pub fn key_opens(conn: &Connection, key: &SecretKey) -> DbResult<bool> {
    let row: Option<(String, Vec<u8>)> = conn
        .query_row("SELECT name, spec FROM credentials LIMIT 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    Ok(row.is_none_or(|(name, blob)| sealing::open_spec(&name, &blob, key).is_ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::SecretSpec;
    use secrecy::{ExposeSecret, SecretString};

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        conn
    }

    fn user() -> Actor {
        Actor {
            id: "u-1".into(),
            name: "Ana Duarte".into(),
        }
    }

    fn report() -> ValidationReport {
        ValidationReport {
            at: "now".into(),
            results: Vec::new(),
        }
    }

    fn name(s: &str) -> ResourceName {
        ResourceName::parse(s).unwrap()
    }

    fn s3(secret: &str) -> SecretSpec {
        SecretSpec::S3 {
            access_key_id: "AKIA".into(),
            secret_access_key: SecretString::from(secret),
            region: "eu-west-1".into(),
            role_arn: None,
            external_id: None,
        }
    }

    fn secret_of(spec: &SecretSpec) -> String {
        match spec {
            SecretSpec::S3 {
                secret_access_key, ..
            } => secret_access_key.expose_secret().to_string(),
            _ => panic!("not s3"),
        }
    }

    /// The spec round-trips through the seal, the row holds no plaintext, and a
    /// ciphertext moved under another name does not open.
    #[test]
    fn a_spec_is_sealed_to_its_row() {
        let conn = conn();
        let key = SecretKey::for_tests();
        insert(
            &conn,
            &key,
            &name("minio"),
            &s3("sh-secret"),
            &user(),
            &report(),
        )
        .unwrap();

        let stored = get(&conn, &key, "minio").unwrap().unwrap();
        assert_eq!(secret_of(&stored.spec), "sh-secret");

        let blob: Vec<u8> = conn
            .query_row("SELECT spec FROM credentials", [], |r| r.get(0))
            .unwrap();
        assert!(!String::from_utf8_lossy(&blob).contains("sh-secret"));

        insert(&conn, &key, &name("other"), &s3("x"), &user(), &report()).unwrap();
        conn.execute(
            "UPDATE credentials SET spec = ?1 WHERE name = 'other'",
            [&blob],
        )
        .unwrap();
        assert!(matches!(get(&conn, &key, "other"), Err(DbError::Secret(_))));
    }

    #[test]
    fn a_rename_seals_again() {
        let conn = conn();
        let key = SecretKey::for_tests();
        insert(&conn, &key, &name("a"), &s3("one"), &user(), &report()).unwrap();
        let spec = get(&conn, &key, "a").unwrap().unwrap().spec;
        update(&conn, &key, "a", &name("b"), &spec, &user(), None).unwrap();
        assert!(get(&conn, &key, "a").unwrap().is_none());
        assert_eq!(
            secret_of(&get(&conn, &key, "b").unwrap().unwrap().spec),
            "one"
        );
    }
}
