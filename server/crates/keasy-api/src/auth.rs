use serde::Serialize;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct WorkspacesResponse {
    /// Slugs of every workspace the user belongs to, read from the `workspaces`
    /// claim on the token this request carried. The web builds each
    /// `<slug>.<domain>` link.
    pub workspaces: Vec<String>,
    /// This instance's slug — the "current" entry in the switcher.
    pub current: String,
    /// This instance's display name (`KEASY_WORKSPACE_NAME`). The other
    /// entries show their slug: an instance only knows its own name.
    pub current_name: String,
}
