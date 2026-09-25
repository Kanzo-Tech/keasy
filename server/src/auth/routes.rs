use axum::Json;
use axum::extract::State;
use axum::response::IntoResponse;

use keasy_api::auth::WorkspacesResponse;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::AppState;
use crate::auth::bearer::AuthenticatedUser;
use crate::db::DbError;

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
) -> Result<impl IntoResponse, DbError> {
    let current_name = state
        .db
        .get_workspace_identity()
        .await?
        .map(|i| i.name)
        .unwrap_or_default();

    Ok(Json(WorkspacesResponse {
        workspaces: user.claims.workspaces,
        current: state.workspace_slug.clone().unwrap_or_default(),
        current_name,
    }))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_workspaces))
}
