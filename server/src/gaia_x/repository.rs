use async_trait::async_trait;

use super::GaiaxState;

#[async_trait]
pub trait GaiaXRepository: Send + Sync {
    async fn get_gaiax_state(&self, org_id: &str) -> Result<Option<GaiaxState>, String>;
    async fn upsert_gaiax_state(&self, state: &GaiaxState) -> Result<(), String>;
}
