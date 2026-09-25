pub mod ai;
pub mod schema;

use serde::{Deserialize, Serialize};

/// The workspace write sink, as the owner's Catalog Storage page edits it.
#[derive(Debug, Deserialize, Serialize, utoipa::ToSchema)]
pub struct CatalogStoragePayload {
    pub cloud_account_id: String,
    pub base_url: String,
}
