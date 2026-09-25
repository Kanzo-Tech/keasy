use keasy_api::connections::{ConnectionKind, Direction, LocationType};

/// The name the one sink row carries, wherever it is written from — the owner's
/// catalog-storage page or the environment that declared it at boot.
pub const SINK_NAME: &str = "Workspace output";

#[derive(Debug)]
pub struct UpdateConnectionRequest {
    pub name: Option<String>,
    pub kind: Option<ConnectionKind>,
    pub location_type: Option<LocationType>,
    pub direction: Option<Direction>,
    pub cloud_account_id: Option<String>,
    pub url: Option<String>,
}
