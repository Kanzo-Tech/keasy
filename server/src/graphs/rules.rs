//! The `rules` table: one SHACL shapes graph per graph, stored opaque.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{DbError, DbResult, provenance_columns};
use crate::domain::{Actor, Rules, now_iso8601};

pub fn get(conn: &Connection, graph_id: &str) -> DbResult<Option<Rules>> {
    Ok(conn
        .query_row(
            "SELECT shapes, created_by, created_by_name, created_at,
                    updated_by, updated_by_name, updated_at
             FROM rules WHERE graph_id = ?1",
            [graph_id],
            |row| {
                Ok(Rules {
                    shapes: row.get("shapes")?,
                    provenance: provenance_columns(row)?,
                })
            },
        )
        .optional()?)
}

/// Replace the graph's rules with `shapes`: the first save creates them, every
/// later one updates them and keeps who created them.
pub fn put(conn: &Connection, graph_id: &str, shapes: &str, by: &Actor) -> DbResult<Rules> {
    let now = now_iso8601();
    conn.execute(
        "INSERT INTO rules (graph_id, shapes, created_by, created_by_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (graph_id) DO UPDATE SET
             shapes = excluded.shapes, updated_by = excluded.created_by,
             updated_by_name = excluded.created_by_name, updated_at = excluded.created_at",
        params![graph_id, shapes, by.id, by.name, now],
    )?;
    get(conn, graph_id)?.ok_or_else(|| DbError::Invalid(format!("no graph {graph_id:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Graph;

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

    /// Saved, replaced and read back byte for byte; gone with its graph.
    #[test]
    fn the_rules_are_the_last_shapes_saved_and_die_with_their_graph() {
        let (conn, id) = conn_with_graph();
        assert!(get(&conn, &id).unwrap().is_none());

        let first = put(
            &conn,
            &id,
            "@prefix sh: <http://www.w3.org/ns/shacl#> .",
            &ana(),
        )
        .unwrap();
        assert_eq!(first.provenance.created_by, ana());
        assert_eq!(first.provenance.updated_by, None);
        let shapes = "@prefix sh: <http://www.w3.org/ns/shacl#> .\n\n<#S> a sh:NodeShape ;\n  sh:message \"ñ\" .\n";
        put(&conn, &id, shapes, &bruno()).unwrap();
        let saved = get(&conn, &id).unwrap().unwrap();
        assert_eq!(saved.shapes, shapes);
        assert_eq!(saved.provenance.created_by, ana(), "the creator is kept");
        assert_eq!(saved.provenance.updated_by, Some(bruno()));

        crate::graphs::persistence::delete(&conn, &id).unwrap();
        assert!(get(&conn, &id).unwrap().is_none());
    }

    #[test]
    fn rules_need_their_graph() {
        let (conn, _) = conn_with_graph();
        assert!(put(&conn, "no-such-graph", "", &ana()).is_err());
    }
}
