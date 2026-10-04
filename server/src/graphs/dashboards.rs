//! The `dashboards` table: one saved dashboard per graph, stored opaque.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{DbError, DbResult, json_column, provenance_columns};
use crate::domain::{Actor, Dashboard, now_iso8601};

pub fn get(conn: &Connection, graph_id: &str) -> DbResult<Option<Dashboard>> {
    Ok(conn
        .query_row(
            "SELECT spec, created_by, created_by_name, created_at,
                    updated_by, updated_by_name, updated_at
             FROM dashboards WHERE graph_id = ?1",
            [graph_id],
            |row| {
                Ok(Dashboard {
                    spec: json_column(row, "spec")?,
                    provenance: provenance_columns(row)?,
                })
            },
        )
        .optional()?)
}

/// Replace the graph's dashboard with `spec`: the first save creates it, every
/// later one updates it and keeps who created it.
pub fn put(
    conn: &Connection,
    graph_id: &str,
    spec: serde_json::Map<String, serde_json::Value>,
    by: &Actor,
) -> DbResult<Dashboard> {
    let now = now_iso8601();
    conn.execute(
        "INSERT INTO dashboards (graph_id, spec, created_by, created_by_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (graph_id) DO UPDATE SET
             spec = excluded.spec, updated_by = excluded.created_by,
             updated_by_name = excluded.created_by_name, updated_at = excluded.created_at",
        params![graph_id, serde_json::to_string(&spec)?, by.id, by.name, now],
    )?;
    get(conn, graph_id)?.ok_or_else(|| DbError::Invalid(format!("no graph {graph_id:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Graph;
    use serde_json::json;

    fn conn_with_graph() -> (Connection, String) {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        crate::connections::persistence::tests::seed_sink(&conn, "sink");
        let graph = Graph::new(None, "sink".into(), None, "x".into(), ana());
        crate::graphs::persistence::insert(&conn, &graph).unwrap();
        (conn, graph.id)
    }

    fn ana() -> Actor {
        Actor {
            id: "u-1".into(),
            name: "Ana Duarte".into(),
        }
    }

    fn bruno() -> Actor {
        Actor {
            id: "u-2".into(),
            name: "Bruno".into(),
        }
    }

    fn object(v: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        v.as_object().unwrap().clone()
    }

    /// Saved, replaced and read back verbatim; gone with its graph.
    #[test]
    fn a_dashboard_is_the_last_spec_saved_and_dies_with_its_graph() {
        let (conn, id) = conn_with_graph();
        assert!(get(&conn, &id).unwrap().is_none());

        let first = put(&conn, &id, object(json!({ "cards": [1] })), &ana()).unwrap();
        assert_eq!(first.provenance.created_by, ana());
        assert_eq!(first.provenance.updated_by, None);
        put(
            &conn,
            &id,
            object(json!({ "cards": [2], "x": { "y": null } })),
            &bruno(),
        )
        .unwrap();
        let saved = get(&conn, &id).unwrap().unwrap();
        assert_eq!(
            serde_json::Value::Object(saved.spec),
            json!({ "cards": [2], "x": { "y": null } })
        );
        assert_eq!(saved.provenance.created_by, ana(), "the creator is kept");
        assert_eq!(saved.provenance.updated_by, Some(bruno()));

        crate::graphs::persistence::delete(&conn, &id).unwrap();
        assert!(get(&conn, &id).unwrap().is_none());
    }

    #[test]
    fn a_dashboard_needs_its_graph() {
        let (conn, _) = conn_with_graph();
        assert!(put(&conn, "no-such-graph", object(json!({})), &ana()).is_err());
    }
}
