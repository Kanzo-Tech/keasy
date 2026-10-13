//! The `conversations` table: the assistant's conversations, their messages
//! stored opaque and replaced whole.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{DbError, DbResult, json_column, owner_columns, provenance_columns};
use crate::domain::{Actor, Conversation, now_iso8601};

const SELECT: &str = "SELECT id, messages, owner, owner_name, created_by, created_by_name,
                             created_at, updated_by, updated_by_name, updated_at,
                             EXISTS (SELECT 1 FROM graphs WHERE graphs.conversation = conversations.id)
                                 AS built
                      FROM conversations";

fn row_to_conversation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: row.get("id")?,
        messages: json_column(row, "messages")?,
        built: row.get("built")?,
        owner: owner_columns(row)?,
        provenance: provenance_columns(row)?,
    })
}

/// A new conversation of `messages`, owned by who started it.
pub fn insert(
    conn: &Connection,
    messages: &[serde_json::Value],
    by: &Actor,
) -> DbResult<Conversation> {
    let id = uuid::Uuid::new_v4().to_string();
    let owner = by.as_owner();
    conn.execute(
        "INSERT INTO conversations (id, messages, owner, owner_name, created_by, created_by_name,
                                    created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            serde_json::to_string(messages)?,
            owner.id,
            owner.name,
            by.id,
            by.name,
            now_iso8601()
        ],
    )?;
    get(conn, &id)?.ok_or_else(|| DbError::Invalid(format!("no conversation {id:?}")))
}

pub fn get(conn: &Connection, id: &str) -> DbResult<Option<Conversation>> {
    Ok(conn
        .query_row(
            &format!("{SELECT} WHERE id = ?1"),
            [id],
            row_to_conversation,
        )
        .optional()?)
}

/// Replace the messages of `id` with `messages`, unless a graph was built from
/// it meanwhile: one statement, so a build and a save do not cross. `None`
/// when nothing was replaced; the caller reads the row to say why.
pub fn replace(
    conn: &Connection,
    id: &str,
    messages: &[serde_json::Value],
    by: &Actor,
) -> DbResult<Option<Conversation>> {
    let replaced = conn.execute(
        "UPDATE conversations SET messages = ?1, updated_by = ?2, updated_by_name = ?3,
                                  updated_at = ?4
         WHERE id = ?5
           AND NOT EXISTS (SELECT 1 FROM graphs WHERE graphs.conversation = ?5)",
        params![
            serde_json::to_string(messages)?,
            by.id,
            by.name,
            now_iso8601(),
            id
        ],
    )?;
    if replaced == 0 {
        return Ok(None);
    }
    get(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Graph;
    use serde_json::json;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        crate::connections::persistence::tests::seed_sink(&conn, "sink");
        conn
    }

    fn ana() -> Actor {
        Actor {
            id: "u-1".into(),
            name: "Ana Duarte".into(),
        }
    }

    /// Saved whole and read back verbatim, until a graph is built from it.
    #[test]
    fn a_conversation_is_its_last_save_until_a_graph_is_built_from_it() {
        let conn = conn();
        let started = insert(&conn, &[json!({ "id": "m1", "role": "assistant" })], &ana()).unwrap();
        assert!(!started.built);
        assert_eq!(started.owner, ana());

        let messages = [json!({ "id": "m1" }), json!({ "id": "m2", "parts": [] })];
        let saved = replace(&conn, &started.id, &messages, &ana())
            .unwrap()
            .unwrap();
        assert_eq!(saved.messages, messages);
        assert_eq!(saved.provenance.updated_by, Some(ana()));

        let graph = Graph {
            conversation: Some(started.id.clone()),
            ..Graph::new(None, "sink".into(), None, "x".into(), ana())
        };
        crate::graphs::persistence::insert(&conn, &graph).unwrap();
        assert!(get(&conn, &started.id).unwrap().unwrap().built);
        assert!(
            replace(&conn, &started.id, &[], &ana()).unwrap().is_none(),
            "a built conversation is its graph's record"
        );
        assert_eq!(get(&conn, &started.id).unwrap().unwrap().messages, messages);
        assert!(replace(&conn, "no-such", &[], &ana()).unwrap().is_none());
    }
}
