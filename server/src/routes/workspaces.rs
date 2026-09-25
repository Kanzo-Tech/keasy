use axum::Json;
use axum::extract::State;
use axum::response::IntoResponse;
use serde::Serialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::middleware::AuthenticatedUser;
use crate::startup::AppState;

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

/// GET /v1/auth/workspaces
///
/// The one thing the web cannot answer from its own session: the switcher's
/// list. `Session` carries who you are and what you may do, and the workspaces
/// claim is neither — so it is read here, off the token this server verified,
/// rather than copied into a shape the browser would have to be trusted about.
///
/// It takes no role extractor: someone authenticated but
/// holding no role here still needs to be told where they *do* belong.
#[utoipa::path(get, path = "/v1/auth/workspaces", tag = "Auth",
    responses((status = 200, description = "List of accessible workspaces", body = WorkspacesResponse))
)]
pub async fn list_workspaces(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> impl IntoResponse {
    Json(WorkspacesResponse {
        workspaces: user.claims.workspaces,
        current: state.workspace_slug.clone().unwrap_or_default(),
        current_name: state.workspace_name.clone(),
    })
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_workspaces))
}
