//! The `grants` table, and what an object's owner changes: who else manages
//! it, who uses a secret, who owns it, and what passes to the workspace when
//! someone leaves. Reading grants is not here — every object is read with its
//! own ([`crate::database::grants_of`]).

use rusqlite::{Connection, params};

use crate::database::DbResult;
use crate::domain::{Actor, Principal, Relation};

/// An object grants are made on: the column of `grants` that names it, and
/// the table and key it names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Object<'a> {
    Secret(&'a str),
    Connection(&'a str),
    Graph(&'a str),
}

impl Object<'_> {
    fn column(self) -> &'static str {
        match self {
            Object::Secret(_) => "secret",
            Object::Connection(_) => "connection",
            Object::Graph(_) => "graph",
        }
    }

    fn table(self) -> (&'static str, &'static str) {
        match self {
            Object::Secret(_) => ("credentials", "name"),
            Object::Connection(_) => ("connections", "name"),
            Object::Graph(_) => ("graphs", "id"),
        }
    }

    fn id(&self) -> &str {
        match self {
            Object::Secret(id) | Object::Connection(id) | Object::Graph(id) => id,
        }
    }
}

/// Make `grants` the object's grants, in one transaction: what is no longer
/// there goes, what is new is granted by `by` now, and what stays keeps who
/// granted it and when — its name refreshed to the one given.
pub fn replace(
    conn: &Connection,
    object: Object<'_>,
    grants: &[(Principal, Relation)],
    by: &Actor,
) -> DbResult<()> {
    let column = object.column();
    let tx = conn.unchecked_transaction()?;
    let kept: Vec<String> = grants
        .iter()
        .map(|(p, r)| format!("{}\u{1f}{}\u{1f}{}", p.kind.as_ref(), p.id, r.as_ref()))
        .collect();
    tx.execute(
        &format!(
            "DELETE FROM grants WHERE {column} = ?1
               AND principal_kind || char(31) || principal || char(31) || relation
                   NOT IN (SELECT value FROM json_each(?2))"
        ),
        params![object.id(), serde_json::to_string(&kept)?],
    )?;
    let now = crate::domain::now_iso8601();
    for (principal, relation) in grants {
        tx.execute(
            &format!(
                "INSERT INTO grants ({column}, principal_kind, principal, principal_name, relation,
                                     created_by, created_by_name, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT DO UPDATE SET principal_name = excluded.principal_name"
            ),
            params![
                object.id(),
                principal.kind.as_ref(),
                principal.id,
                principal.name,
                relation.as_ref(),
                by.id,
                by.name,
                now
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Give the object to `owner`. Who it was given by is not kept: the owner is
/// what permissions read, and the grants say who shares it.
pub fn transfer(conn: &Connection, object: Object<'_>, owner: &Actor) -> DbResult<()> {
    let (table, key) = object.table();
    conn.execute(
        &format!("UPDATE {table} SET owner = ?1, owner_name = ?2 WHERE {key} = ?3"),
        params![owner.id, owner.name, object.id()],
    )?;
    Ok(())
}

/// What passes to the workspace when the person `sub` leaves: every secret,
/// connection and graph they own, and the grants made to them go — a grant to
/// someone who is not here holds for no one. Their name stays where it says
/// who created something: that never changes. How many objects passed.
pub fn depart(conn: &Connection, sub: &str) -> DbResult<usize> {
    let workspace = Actor::workspace();
    let tx = conn.unchecked_transaction()?;
    let mut passed = 0;
    for table in ["credentials", "connections", "graphs"] {
        passed += tx.execute(
            &format!("UPDATE {table} SET owner = ?1, owner_name = ?2 WHERE owner = ?3"),
            params![workspace.id, workspace.name, sub],
        )?;
    }
    tx.execute(
        "DELETE FROM grants WHERE principal_kind = 'user' AND principal = ?1",
        [sub],
    )?;
    tx.commit()?;
    Ok(passed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::PrincipalKind;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::database::apply_schema(&conn).unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO credentials (name, spec, owner, owner_name, created_by, created_by_name, created_at)
                VALUES ('s', x'00', 'u-1', 'Ana', 'u-1', 'Ana', 't'),
                       ('t', x'00', 'u-2', 'Bruno', 'u-2', 'Bruno', 't');
            INSERT INTO connections (name, credential, target, owner, owner_name, created_by, created_by_name, created_at)
                VALUES ('sink', 's', '{"direction":"sink"}', 'workspace', 'Workspace', 'bootstrap', 'Bootstrap', 't');
            INSERT INTO graphs (id, status, created_at, owner, owner_name, created_by, created_by_name, sink_connection)
                VALUES ('g', 'draft', 't', 'u-1', 'Ana', 'u-1', 'Ana', 'sink');
            "#,
        )
        .unwrap();
        conn
    }

    fn actor(id: &str, name: &str) -> Actor {
        Actor {
            id: id.into(),
            name: name.into(),
        }
    }

    fn principal(kind: PrincipalKind, id: &str, name: &str) -> Principal {
        Principal {
            kind,
            id: id.into(),
            name: name.into(),
        }
    }

    fn rows(conn: &Connection) -> Vec<(String, String, String, String)> {
        conn.prepare(
            "SELECT principal, principal_name, relation, created_by FROM grants ORDER BY principal, relation",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
    }

    /// Replacing keeps who granted what stays, renames it, and drops what
    /// is gone — on that object only.
    #[test]
    fn replacing_keeps_what_stays_and_drops_what_goes() {
        let conn = conn();
        let ana = actor("u-1", "Ana");
        let research = principal(PrincipalKind::Group, "g-1", "Research");
        let bruno = principal(PrincipalKind::User, "u-2", "Bruno");
        replace(
            &conn,
            Object::Secret("s"),
            &[
                (research.clone(), Relation::User),
                (bruno.clone(), Relation::Manager),
            ],
            &ana,
        )
        .unwrap();
        replace(
            &conn,
            Object::Graph("g"),
            &[(bruno.clone(), Relation::Manager)],
            &ana,
        )
        .unwrap();

        let renamed = principal(PrincipalKind::Group, "g-1", "Research & ML");
        replace(
            &conn,
            Object::Secret("s"),
            &[(renamed, Relation::User)],
            &actor("u-9", "Admin"),
        )
        .unwrap();
        let row = |p: &str, n: &str, r: &str, b: &str| {
            (p.to_string(), n.to_string(), r.to_string(), b.to_string())
        };
        assert_eq!(
            rows(&conn),
            [
                row("g-1", "Research & ML", "user", "u-1"),
                row("u-2", "Bruno", "manager", "u-1"),
            ],
            "the secret's manager went, the graph's stayed, and who granted what stayed is kept"
        );
    }

    /// Leaving passes what they own to the workspace and ends the grants to
    /// them; what they created still says they did.
    #[test]
    fn who_leaves_leaves_what_they_own_to_the_workspace() {
        let conn = conn();
        replace(
            &conn,
            Object::Secret("t"),
            &[(principal(PrincipalKind::User, "u-1", "Ana"), Relation::User)],
            &actor("u-2", "Bruno"),
        )
        .unwrap();
        assert_eq!(depart(&conn, "u-1").unwrap(), 2);
        let owned: Vec<(String, String)> = conn
            .prepare(
                "SELECT owner, created_by FROM credentials WHERE name = 's'
                 UNION ALL SELECT owner, created_by FROM graphs",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let workspace = ("workspace".to_string(), "u-1".to_string());
        assert_eq!(owned, [workspace.clone(), workspace]);
        assert!(rows(&conn).is_empty(), "the grant to them is gone");
        let theirs: String = conn
            .query_row("SELECT owner FROM credentials WHERE name = 't'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(theirs, "u-2", "what others own stays theirs");
    }

    #[test]
    fn a_transfer_changes_the_owner_and_nothing_else() {
        let conn = conn();
        transfer(&conn, Object::Graph("g"), &actor("u-2", "Bruno")).unwrap();
        let (owner, name, created): (String, String, String) = conn
            .query_row(
                "SELECT owner, owner_name, created_by FROM graphs",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (owner.as_str(), name.as_str(), created.as_str()),
            ("u-2", "Bruno", "u-1")
        );
    }
}
