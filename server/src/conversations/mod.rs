//! The `conversations` table: the assistant's conversations, their messages
//! stored opaque and replaced whole.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{DbResult, json_column, owner_columns, provenance_columns};
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

/// Save `messages` as conversation `id`, the client's own: a new conversation,
/// owned by who started it, or every message of an existing one replaced —
/// unless a graph was built from it, which is that graph's record. One
/// statement, so a build and a save do not cross. `None` when nothing was
/// written; the caller reads the row to say why.
pub fn save(
    conn: &Connection,
    id: &str,
    messages: &[serde_json::Value],
    by: &Actor,
) -> DbResult<Option<Conversation>> {
    let owner = by.as_owner();
    let written = conn.execute(
        "INSERT INTO conversations (id, messages, owner, owner_name, created_by, created_by_name,
                                    created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (id) DO UPDATE SET messages = excluded.messages, updated_by = excluded.created_by,
                                        updated_by_name = excluded.created_by_name,
                                        updated_at = excluded.created_at
         WHERE NOT EXISTS (SELECT 1 FROM graphs WHERE graphs.conversation = ?1)",
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
    if written == 0 {
        return Ok(None);
    }
    get(conn, id)
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

    /// Saved whole under the client's id and read back verbatim, until a graph is
    /// built from it.
    #[test]
    fn a_conversation_is_its_last_save_until_a_graph_is_built_from_it() {
        let conn = conn();
        let id = "0b0e7c1e-6c4f-4d0a-9d55-3f1d2c4b5a69";
        let started = save(
            &conn,
            id,
            &[json!({ "id": "m1", "role": "assistant" })],
            &ana(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(started.id, id);
        assert!(!started.built);
        assert_eq!(started.owner, ana());
        assert_eq!(started.provenance.updated_by, None);

        let messages = [json!({ "id": "m1" }), json!({ "id": "m2", "parts": [] })];
        let saved = save(&conn, id, &messages, &ana()).unwrap().unwrap();
        assert_eq!(saved.messages, messages);
        assert_eq!(saved.provenance.updated_by, Some(ana()));

        let graph = Graph {
            conversation: Some(id.into()),
            ..Graph::new(None, "sink".into(), None, "x".into(), ana())
        };
        crate::graphs::persistence::insert(&conn, &graph).unwrap();
        assert!(get(&conn, id).unwrap().unwrap().built);
        assert!(
            save(&conn, id, &[], &ana()).unwrap().is_none(),
            "a built conversation is its graph's record"
        );
        assert_eq!(get(&conn, id).unwrap().unwrap().messages, messages);
    }
}
