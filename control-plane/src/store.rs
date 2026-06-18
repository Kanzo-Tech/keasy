//! SQLite persistence for the workspace registry.
//!
//! The provisioner is otherwise stateless; this is its one piece of durable state
//! — the map `workspace_id → {keycloak_uuid, slug, version, …}` that teardown and
//! the reconciler need to survive a control-plane restart. Without it, a restart
//! would lose the registry and the reconciler could not diff desired-vs-real (and
//! teardown could not find the OIDC client to delete). Same schema-in-code +
//! `PRAGMA user_version` migration idiom as keasy-server's `db::schema`.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

/// A persisted workspace record — everything teardown + reconcile need.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredWorkspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub url: String,
    pub owner_keycloak_sub: String,
    /// Keycloak-internal client UUID, needed to delete the OIDC client on teardown.
    pub keycloak_uuid: String,
    /// The keasy-server image this instance is provisioned at — the reconciler
    /// compares it against the desired version to decide a rollout.
    pub server_image: String,
    /// OIDC client secret Keycloak generated for this workspace. Stored so a
    /// rollout can re-render the full compose file (it is already on the
    /// control-plane's private disk inside the rendered `<id>.yml`, same trust
    /// boundary). NEVER served by the API.
    pub oidc_client_secret: String,
}

/// Append-only DDL steps. `MIGRATIONS[i]` migrates `user_version` `i` → `i + 1`.
const MIGRATIONS: &[&str] = &[
    "
    CREATE TABLE IF NOT EXISTS workspaces (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        slug               TEXT NOT NULL,
        url                TEXT NOT NULL,
        owner_keycloak_sub TEXT NOT NULL,
        keycloak_uuid      TEXT NOT NULL,
        server_image       TEXT NOT NULL,
        oidc_client_secret TEXT NOT NULL
    );
    ",
    "
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
    ",
];

const COLS: &str =
    "id, name, slug, url, owner_keycloak_sub, keycloak_uuid, server_image, oidc_client_secret";

/// SQLite-backed workspace registry. A single mutex-guarded connection — the
/// provisioner is low-traffic, so brief synchronous critical sections are fine.
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Open (creating + migrating) the registry DB at `path`.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(|e| format!("create db dir: {e}"))?;
        }
        let conn = Connection::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
            .map_err(|e| format!("pragmas: {e}"))?;
        migrate(&conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Insert or update a workspace record (idempotent re-provision).
    pub fn upsert(&self, w: &StoredWorkspace) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, name, slug, url, owner_keycloak_sub, keycloak_uuid, server_image, oidc_client_secret)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, slug=excluded.slug, url=excluded.url,
                owner_keycloak_sub=excluded.owner_keycloak_sub,
                keycloak_uuid=excluded.keycloak_uuid, server_image=excluded.server_image,
                oidc_client_secret=excluded.oidc_client_secret",
            rusqlite::params![
                w.id, w.name, w.slug, w.url, w.owner_keycloak_sub, w.keycloak_uuid,
                w.server_image, w.oidc_client_secret
            ],
        )
        .map_err(|e| format!("upsert workspace: {e}"))?;
        Ok(())
    }

    /// Delete a workspace, returning the record that was removed (if any).
    pub fn remove(&self, id: &str) -> Result<Option<StoredWorkspace>, String> {
        let conn = self.conn.lock().unwrap();
        let existing = get_row(&conn, id)?;
        if existing.is_some() {
            conn.execute("DELETE FROM workspaces WHERE id=?1", [id])
                .map_err(|e| format!("delete workspace: {e}"))?;
        }
        Ok(existing)
    }

    /// Look up a single workspace.
    pub fn get(&self, id: &str) -> Result<Option<StoredWorkspace>, String> {
        let conn = self.conn.lock().unwrap();
        get_row(&conn, id)
    }

    /// All workspaces, ordered by slug.
    pub fn list(&self) -> Result<Vec<StoredWorkspace>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(&format!("SELECT {COLS} FROM workspaces ORDER BY slug"))
            .map_err(|e| format!("prepare list: {e}"))?;
        let rows = stmt
            .query_map([], row_to_workspace)
            .map_err(|e| format!("query list: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("read list: {e}"))
    }

    /// Workspaces owned by a given Keycloak sub (list a user's projects).
    pub fn list_by_owner(&self, sub: &str) -> Result<Vec<StoredWorkspace>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {COLS} FROM workspaces WHERE owner_keycloak_sub=?1 ORDER BY slug"
            ))
            .map_err(|e| format!("prepare list_by_owner: {e}"))?;
        let rows = stmt
            .query_map([sub], row_to_workspace)
            .map_err(|e| format!("query list_by_owner: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("read list_by_owner: {e}"))
    }

    /// Whether a slug is already taken (the handle availability check).
    pub fn slug_taken(&self, slug: &str) -> Result<bool, String> {
        let conn = self.conn.lock().unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM workspaces WHERE slug=?1", [slug], |r| r.get(0))
            .map_err(|e| format!("count slug: {e}"))?;
        Ok(n > 0)
    }
}

fn get_row(conn: &Connection, id: &str) -> Result<Option<StoredWorkspace>, String> {
    conn.query_row(
        &format!("SELECT {COLS} FROM workspaces WHERE id=?1"),
        [id],
        row_to_workspace,
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(format!("get workspace: {other}")),
    })
}

fn row_to_workspace(r: &rusqlite::Row) -> rusqlite::Result<StoredWorkspace> {
    Ok(StoredWorkspace {
        id: r.get(0)?,
        name: r.get(1)?,
        slug: r.get(2)?,
        url: r.get(3)?,
        owner_keycloak_sub: r.get(4)?,
        keycloak_uuid: r.get(5)?,
        server_image: r.get(6)?,
        oidc_client_secret: r.get(7)?,
    })
}

/// Run every migration past the DB's current `user_version`, each transactionally.
fn migrate(conn: &Connection) -> Result<(), String> {
    let current: u32 = conn
        .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
        .map_err(|e| format!("read user_version: {e}"))? as u32;
    for (idx, m) in MIGRATIONS.iter().enumerate() {
        let target = idx as u32 + 1;
        if current >= target {
            continue;
        }
        conn.execute_batch(&format!("BEGIN; {m}\nPRAGMA user_version = {target}; COMMIT;"))
            .map_err(|e| format!("migration to v{target}: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, slug: &str) -> StoredWorkspace {
        StoredWorkspace {
            id: id.into(),
            name: slug.into(),
            slug: slug.into(),
            url: format!("https://{slug}.keasy.local"),
            owner_keycloak_sub: "sub-123".into(),
            keycloak_uuid: format!("kc-{id}"),
            server_image: "ghcr.io/kanzo-tech/keasy-server:0.3.0".into(),
            oidc_client_secret: "shh".into(),
        }
    }

    fn mem_store() -> Store {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        Store { conn: Mutex::new(conn) }
    }

    #[test]
    fn upsert_get_list_remove_roundtrip() {
        let s = mem_store();
        let a = sample("keasy-ws-a", "acme");
        let b = sample("keasy-ws-b", "globex");
        s.upsert(&a).unwrap();
        s.upsert(&b).unwrap();

        assert_eq!(s.get("keasy-ws-a").unwrap().as_ref(), Some(&a));
        assert_eq!(s.list().unwrap(), vec![a.clone(), b.clone()]); // slug order: acme, globex

        let removed = s.remove("keasy-ws-a").unwrap();
        assert_eq!(removed.as_ref(), Some(&a));
        assert!(s.get("keasy-ws-a").unwrap().is_none());
        assert_eq!(s.list().unwrap(), vec![b]);
    }

    #[test]
    fn upsert_updates_version_in_place() {
        let s = mem_store();
        let mut w = sample("keasy-ws-a", "acme");
        s.upsert(&w).unwrap();
        w.server_image = "ghcr.io/kanzo-tech/keasy-server:0.4.0".into();
        s.upsert(&w).unwrap(); // same id → update, not duplicate
        assert_eq!(s.list().unwrap().len(), 1);
        assert_eq!(s.get("keasy-ws-a").unwrap().unwrap().server_image, w.server_image);
    }

    #[test]
    fn remove_absent_is_none() {
        let s = mem_store();
        assert!(s.remove("nope").unwrap().is_none());
    }

    #[test]
    fn list_by_owner_filters_and_unique_slug_is_enforced() {
        let s = mem_store();
        let mut a = sample("keasy-ws-a", "acme");
        a.owner_keycloak_sub = "alice".into();
        let mut b = sample("keasy-ws-b", "globex");
        b.owner_keycloak_sub = "bob".into();
        s.upsert(&a).unwrap();
        s.upsert(&b).unwrap();

        assert_eq!(s.list_by_owner("alice").unwrap(), vec![a]);
        assert!(s.list_by_owner("carol").unwrap().is_empty());
        assert!(s.slug_taken("acme").unwrap());
        assert!(!s.slug_taken("free").unwrap());

        // A different id reusing an existing slug must violate the unique index.
        let dup = sample("keasy-ws-c", "acme");
        assert!(s.upsert(&dup).is_err());
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v as u32, MIGRATIONS.len() as u32);
    }
}
