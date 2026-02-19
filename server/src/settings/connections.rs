use std::path::Path;

use super::file_store::FileStore;
use super::types::{Connection, SaveConnectionRequest};

#[derive(Clone)]
pub struct ConnectionStore(FileStore<Vec<Connection>>);

impl ConnectionStore {
    pub fn new(data_dir: &Path) -> Self {
        Self(FileStore::new(data_dir.join("connections.json"), None))
    }

    pub fn list(&self) -> Vec<Connection> {
        self.0.read()
    }

    pub fn get(&self, id: &str) -> Option<Connection> {
        self.0.read().into_iter().find(|c| c.id == id)
    }

    pub fn save(&self, req: SaveConnectionRequest) -> Result<Connection, String> {
        if req.name.trim().is_empty() {
            return Err("name is required".into());
        }
        if req.container_url.trim().is_empty() {
            return Err("container_url is required".into());
        }
        let conn = Connection {
            id: uuid::Uuid::new_v4().to_string(),
            name: req.name,
            cloud_account_id: req.cloud_account_id,
            container_url: req.container_url,
        };
        self.0.update(|v| v.push(conn.clone()));
        Ok(conn)
    }

    pub fn remove(&self, id: &str) {
        self.0.update(|v| v.retain(|c| c.id != id));
    }
}
