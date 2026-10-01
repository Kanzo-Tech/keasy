use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::configuration::ThemeFamily;
use crate::startup::AppState;

/// How this instance looks, as its deployment declares it (`KEASY_BRANDING_FILE`).
/// Public: the web reads it to render the login page and the first paint,
/// before anyone has signed in.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Branding {
    /// This instance's display name (`KEASY_WORKSPACE_NAME`).
    pub name: String,
    /// The mark the shell shows: a URL or a path the web serves.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    /// A theme stylesheet to inline on every page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_css: Option<String>,
    /// The theme families members may choose among; empty allows every
    /// shipped theme.
    pub families: Vec<ThemeFamily>,
    /// The family a visitor starts with; absent leaves the web's own.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    /// Members wear the default and choose nothing.
    pub lock: bool,
}

#[utoipa::path(get, path = "/v1/branding", tag = "Branding", security(()),
    responses((status = 200, description = "This instance's declared look", body = Branding))
)]
pub async fn get_branding(State(state): State<AppState>) -> Json<Branding> {
    let b = &*state.branding;
    Json(Branding {
        name: state.workspace_name.clone(),
        logo: b.logo.clone(),
        theme_css: b.theme_css.clone(),
        families: b.families.clone(),
        default: b.default.clone(),
        lock: b.lock,
    })
}

/// Public: what any visitor's first paint needs.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_branding))
}
