//! The `credentials` table. Every spec is sealed whole; it is opened only here
//! and never leaves the server as anything but a [`CredentialView`].

use rusqlite::{Connection, OptionalExtension, params};

use crate::api::credentials::{CredentialSpecInput, CredentialView, Purpose};
use crate::api::validation::ValidationReport;

use super::sealing::{self, SecretKey};
use crate::db::{DbError, DbResult, constraint, json_column_opt};
use crate::domain::ResourceName;

/// A stored credential, unsealed.
pub struct Credential {
    pub name: String,
    pub spec: CredentialSpecInput,
    pub created_by: String,
    pub created_at: String,
    pub updated_by: String,
    pub updated_at: String,
    pub validation: Option<ValidationReport>,
}

impl Credential {
    pub fn view(&self, used_by: Vec<String>) -> CredentialView {
        CredentialView {
            name: self.name.clone(),
            spec: self.spec.view(),
            used_by,
            created_by: self.created_by.clone(),
            created_at: self.created_at.clone(),
            updated_by: self.updated_by.clone(),
            updated_at: self.updated_at.clone(),
            validation: self.validation.clone(),
        }
    }
}

const COLUMNS: &str = "name, spec, created_by, created_at, updated_by, updated_at, validation";

/// A row, still sealed.
struct Row {
    name: String,
    spec: Vec<u8>,
    created_by: String,
    created_at: String,
    updated_by: String,
    updated_at: String,
    validation: Option<ValidationReport>,
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        name: r.get("name")?,
        spec: r.get("spec")?,
        created_by: r.get("created_by")?,
        created_at: r.get("created_at")?,
        updated_by: r.get("updated_by")?,
        updated_at: r.get("updated_at")?,
        validation: json_column_opt(r, "validation")?,
    })
}

impl Row {
    fn open(self, key: &SecretKey) -> DbResult<Credential> {
        Ok(Credential {
            spec: sealing::open_spec(&self.name, &self.spec, key).map_err(DbError::Secret)?,
            name: self.name,
            created_by: self.created_by,
            created_at: self.created_at,
            updated_by: self.updated_by,
            updated_at: self.updated_at,
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
    spec: &CredentialSpecInput,
    by: &str,
    validation: &ValidationReport,
) -> DbResult<()> {
    let sealed = sealing::seal_spec(name.as_ref(), spec, key).map_err(DbError::Secret)?;
    conn.execute(
        &format!(
            "INSERT INTO credentials (purpose, {COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?5, ?6)"
        ),
        params![
            spec.purpose().as_ref(),
            name.as_ref(),
            sealed,
            by,
            crate::jobs::now_iso8601(),
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

/// Every credential of `purpose` (all without one), each with the connections
/// that use it.
pub fn list(
    conn: &Connection,
    key: &SecretKey,
    purpose: Option<Purpose>,
) -> DbResult<Vec<CredentialView>> {
    let rows = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM credentials WHERE ?1 IS NULL OR purpose = ?1 ORDER BY name"
        ))?
        .query_map([purpose.as_ref().map(AsRef::as_ref)], row)?
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
    spec: &CredentialSpecInput,
    by: &str,
    validation: Option<&ValidationReport>,
) -> DbResult<()> {
    let sealed = sealing::seal_spec(new_name.as_ref(), spec, key).map_err(DbError::Secret)?;
    conn.execute(
        "UPDATE credentials
         SET name = ?1, spec = ?2, updated_by = ?3, updated_at = ?4,
             validation = coalesce(?5, validation)
         WHERE name = ?6",
        params![
            new_name.as_ref(),
            sealed,
            by,
            crate::jobs::now_iso8601(),
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

/// Seal every credential again under `new`, in one transaction: either all of
/// them move to the new key or none does.
pub fn rekey(conn: &mut Connection, old: &SecretKey, new: &SecretKey) -> DbResult<usize> {
    let tx = conn.transaction()?;
    let rows: Vec<(String, Vec<u8>)> = tx
        .prepare("SELECT name, spec FROM credentials")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (name, blob) in &rows {
        let sealed = sealing::reseal(name, blob, old, new).map_err(DbError::Secret)?;
        tx.execute(
            "UPDATE credentials SET spec = ?1 WHERE name = ?2",
            params![sealed, name],
        )?;
    }
    tx.commit()?;
    Ok(rows.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::credentials::StorageCredentialInput;
    use base64::Engine;
    use secrecy::{ExposeSecret, SecretString};

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::apply_schema(&conn).unwrap();
        conn
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

    fn s3(secret: &str) -> CredentialSpecInput {
        CredentialSpecInput::Storage(StorageCredentialInput::S3 {
            access_key_id: "AKIA".into(),
            secret_access_key: SecretString::from(secret),
            region: "eu-west-1".into(),
            endpoint: None,
        })
    }

    fn secret_of(spec: &CredentialSpecInput) -> String {
        match spec {
            CredentialSpecInput::Storage(StorageCredentialInput::S3 {
                secret_access_key, ..
            }) => secret_access_key.expose_secret().to_string(),
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
            "u-1",
            &report(),
        )
        .unwrap();

        let stored = get(&conn, &key, "minio").unwrap().unwrap();
        assert_eq!(secret_of(&stored.spec), "sh-secret");

        let blob: Vec<u8> = conn
            .query_row("SELECT spec FROM credentials", [], |r| r.get(0))
            .unwrap();
        assert!(!String::from_utf8_lossy(&blob).contains("sh-secret"));

        insert(&conn, &key, &name("other"), &s3("x"), "u-1", &report()).unwrap();
        conn.execute(
            "UPDATE credentials SET spec = ?1 WHERE name = 'other'",
            [&blob],
        )
        .unwrap();
        assert!(matches!(get(&conn, &key, "other"), Err(DbError::Secret(_))));
    }

    #[test]
    fn a_rename_seals_again_and_a_rekey_moves_every_row() {
        let mut conn = conn();
        let key = SecretKey::for_tests();
        insert(&conn, &key, &name("a"), &s3("one"), "u-1", &report()).unwrap();
        let spec = get(&conn, &key, "a").unwrap().unwrap().spec;
        update(&conn, &key, "a", &name("b"), &spec, "u-1", None).unwrap();
        assert!(get(&conn, &key, "a").unwrap().is_none());
        assert_eq!(
            secret_of(&get(&conn, &key, "b").unwrap().unwrap().spec),
            "one"
        );

        let new =
            SecretKey::from_base64(&base64::engine::general_purpose::STANDARD.encode([9u8; 32]))
                .unwrap();
        assert_eq!(rekey(&mut conn, &key, &new).unwrap(), 1);
        assert!(!key_opens(&conn, &key).unwrap());
        assert_eq!(
            secret_of(&get(&conn, &new, "b").unwrap().unwrap().spec),
            "one"
        );
    }
}
