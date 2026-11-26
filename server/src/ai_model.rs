//! The external model a workspace runs Ask and the assistant on, when it runs
//! them on one: an OpenAI-compatible API, its model, and the key it takes. An
//! admin sets it; every member's calls go through the server, which alone holds
//! the key. Without one, the page's own model answers, as it always did.

use rusqlite::{Connection, OptionalExtension, params};
use secrecy::zeroize::Zeroizing;
use secrecy::{ExposeSecret, SecretString};
use serde::Serialize;
use utoipa::ToSchema;

use crate::credentials::sealing::{self, SecretKey};
use crate::database::{DbError, DbResult};
use crate::domain::Actor;

/// What the key is sealed to: a key copied into another table does not open.
const AAD: &str = "ai-model";

/// The workspace's external model, its key open: the server's alone.
pub struct AiModel {
    /// The root of the OpenAI-compatible API, without a trailing `/`.
    pub base_url: String,
    /// The model to call, as the provider names it.
    pub model: String,
    /// `None` for an endpoint that takes no key.
    pub api_key: Option<SecretString>,
    pub updated_by: Actor,
    pub updated_at: String,
}

/// What anyone may see of the external model: never its key, only whether
/// there is one.
#[derive(Debug, Serialize, ToSchema)]
pub struct AiModelView {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
    pub updated_by: Actor,
    pub updated_at: String,
}

impl AiModel {
    pub fn view(&self) -> AiModelView {
        AiModelView {
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            has_key: self.api_key.is_some(),
            updated_by: self.updated_by.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

/// The external model, or `None` while the workspace has none.
pub fn get(conn: &Connection, key: &SecretKey) -> DbResult<Option<AiModel>> {
    let row = conn
        .query_row(
            "SELECT base_url, model, api_key, updated_by, updated_by_name, updated_at
             FROM ai_model WHERE id = 1",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<Vec<u8>>>(2)?,
                    Actor {
                        id: r.get(3)?,
                        name: r.get(4)?,
                    },
                    r.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;
    row.map(|(base_url, model, sealed, updated_by, updated_at)| {
        let api_key = sealed
            .map(|blob| {
                let plain =
                    Zeroizing::new(sealing::open(&blob, AAD, key).map_err(DbError::Secret)?);
                let text = String::from_utf8(plain.to_vec())
                    .map_err(|_| DbError::Secret("the sealed key is not text".into()))?;
                Ok::<_, DbError>(SecretString::from(text))
            })
            .transpose()?;
        Ok(AiModel {
            base_url,
            model,
            api_key,
            updated_by,
            updated_at,
        })
    })
    .transpose()
}

/// Set the external model, replacing the one there was, key included.
pub fn put(
    conn: &Connection,
    key: &SecretKey,
    base_url: &str,
    model: &str,
    api_key: Option<&SecretString>,
    by: &Actor,
) -> DbResult<()> {
    let sealed = api_key
        .map(|k| sealing::seal(k.expose_secret().as_bytes(), AAD, key).map_err(DbError::Secret))
        .transpose()?;
    conn.execute(
        "INSERT INTO ai_model (id, base_url, model, api_key, updated_by, updated_by_name, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (id) DO UPDATE SET
             base_url = excluded.base_url,
             model = excluded.model,
             api_key = excluded.api_key,
             updated_by = excluded.updated_by,
             updated_by_name = excluded.updated_by_name,
             updated_at = excluded.updated_at",
        params![
            base_url,
            model,
            sealed,
            by.id,
            by.name,
            crate::domain::now_iso8601()
        ],
    )?;
    Ok(())
}

/// Remove the external model: the page's own answers again. Whether there was one.
pub fn delete(conn: &Connection) -> DbResult<bool> {
    Ok(conn.execute("DELETE FROM ai_model WHERE id = 1", [])? > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::apply_schema(&conn).unwrap();
        conn
    }

    fn ana() -> Actor {
        Actor {
            id: "u-1".into(),
            name: "Ana Duarte".into(),
        }
    }

    #[test]
    fn a_workspace_starts_with_no_external_model() {
        assert!(get(&conn(), &SecretKey::for_tests()).unwrap().is_none());
    }

    #[test]
    fn the_key_is_stored_sealed_and_opens_whole() {
        let (conn, key) = (conn(), SecretKey::for_tests());
        let secret = SecretString::from("sk-test-123");
        put(
            &conn,
            &key,
            "https://api.openai.com/v1",
            "gpt-4o-mini",
            Some(&secret),
            &ana(),
        )
        .unwrap();

        let stored: Vec<u8> = conn
            .query_row("SELECT api_key FROM ai_model", [], |r| r.get(0))
            .unwrap();
        assert!(!String::from_utf8_lossy(&stored).contains("sk-test-123"));

        let model = get(&conn, &key).unwrap().unwrap();
        assert_eq!(model.api_key.unwrap().expose_secret(), "sk-test-123");
        assert_eq!(model.model, "gpt-4o-mini");
        assert_eq!(model.updated_by, ana());
    }

    #[test]
    fn an_endpoint_without_a_key_is_kept_without_one() {
        let (conn, key) = (conn(), SecretKey::for_tests());
        put(
            &conn,
            &key,
            "http://ollama:11434/v1",
            "qwen2.5:1.5b",
            None,
            &ana(),
        )
        .unwrap();
        let model = get(&conn, &key).unwrap().unwrap();
        assert!(model.api_key.is_none());
        assert!(!model.view().has_key);
    }

    #[test]
    fn setting_it_again_replaces_it_and_deleting_it_leaves_none() {
        let (conn, key) = (conn(), SecretKey::for_tests());
        let secret = SecretString::from("sk-1");
        put(&conn, &key, "https://a/v1", "m1", Some(&secret), &ana()).unwrap();
        put(&conn, &key, "https://b/v1", "m2", None, &ana()).unwrap();
        let model = get(&conn, &key).unwrap().unwrap();
        assert_eq!(
            (model.base_url.as_str(), model.model.as_str()),
            ("https://b/v1", "m2")
        );
        assert!(model.api_key.is_none());

        assert!(delete(&conn).unwrap());
        assert!(get(&conn, &key).unwrap().is_none());
        assert!(!delete(&conn).unwrap());
    }

    #[test]
    fn a_key_sealed_under_another_key_does_not_open() {
        let conn = conn();
        let secret = SecretString::from("sk-1");
        put(
            &conn,
            &SecretKey::for_tests(),
            "https://a/v1",
            "m",
            Some(&secret),
            &ana(),
        )
        .unwrap();
        let other = SecretKey::from_base64("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=").unwrap();
        assert!(get(&conn, &other).is_err());
    }
}
