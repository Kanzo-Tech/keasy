use keasy_api::settings::org::OrgIdentity;
use serde::{Deserialize, Serialize};

/// The workspace behind this instance, stored under `workspace_identity` in the
/// `settings` table. `name` is the display name seeded from config at boot; the
/// legal identity is the DCAT publisher, edited on the Organization page.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceIdentity {
    pub name: String,
    #[serde(flatten)]
    pub identity: OrgIdentity,
}
