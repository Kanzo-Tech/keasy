use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use secrecy::{ExposeSecret, SecretString};

use crate::AppState;
use crate::error::{data_response, error_body};
use crate::middleware::tenant::{AnyRole, IsAdmin, IsParticipant, IsPromotor, Require};
use crate::settings::ai::{AiSettings, AiSettingsPayload};
use crate::settings::org::OrgSettings;
use crate::settings::preferences::Preferences;
const KNOWN_PROVIDERS: &[&str] = &["anthropic", "openai"];

#[utoipa::path(get, path = "/v1/settings/organization", tag = "Settings",
    responses(
        (status = 200, description = "Organization settings", body = OrgSettings),
        (status = 204, description = "No settings configured"),
    )
)]
pub async fn get_org_settings(_ctx: Require<IsParticipant>, State(state): State<AppState>) -> Response {
    match state.repos.get_org_settings().await {
        Some(settings) => data_response(settings).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

#[utoipa::path(put, path = "/v1/settings/organization", tag = "Settings",
    request_body = OrgSettings,
    responses(
        (status = 200, description = "Settings saved", body = OrgSettings),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn save_org_settings(
    _ctx: Require<IsAdmin>,
    State(state): State<AppState>,
    Json(payload): Json<OrgSettings>,
) -> Response {
    if payload.publisher_name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "publisher_name is required")),
        ).into_response();
    }
    state.repos.set_org_settings(&payload).await;
    data_response(payload).into_response()
}

#[utoipa::path(get, path = "/v1/settings/preferences", tag = "Settings",
    responses((status = 200, description = "UI preferences", body = Preferences))
)]
pub async fn get_preferences(_ctx: Require<AnyRole>, State(state): State<AppState>) -> impl IntoResponse {
    data_response(state.repos.get_preferences().await)
}

#[utoipa::path(put, path = "/v1/settings/preferences", tag = "Settings",
    request_body = Preferences,
    responses(
        (status = 200, description = "Preferences saved", body = Preferences),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn save_preferences(
    _ctx: Require<AnyRole>,
    State(state): State<AppState>,
    Json(payload): Json<Preferences>,
) -> Response {
    for (val, name) in [
        (&payload.accent_color, "accent_color"),
        (&payload.font_family, "font_family"),
        (&payload.mono_font_family, "mono_font_family"),
        (&payload.font_size, "font_size"),
        (&payload.mono_font_size, "mono_font_size"),
    ] {
        if val.trim().is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(error_body("validation_error", format!("{name} is required"))),
            ).into_response();
        }
    }
    state.repos.set_preferences(&payload).await;
    data_response(payload).into_response()
}

#[utoipa::path(get, path = "/v1/settings/ai/providers", tag = "Settings",
    responses((status = 200, description = "List of AI providers", body = Vec<AiSettingsPayload>))
)]
pub async fn list_ai_providers(_ctx: Require<IsParticipant>, State(state): State<AppState>) -> impl IntoResponse {
    let providers = state.repos.list_ai_providers().await;
    let payloads: Vec<AiSettingsPayload> = providers.iter().map(to_payload).collect();
    data_response(payloads)
}

#[utoipa::path(put, path = "/v1/settings/ai/providers/{provider_id}", tag = "Settings",
    params(("provider_id" = String, Path, description = "Provider ID (e.g. anthropic, openai)")),
    request_body = AiSettingsPayload,
    responses(
        (status = 200, description = "Provider saved", body = AiSettingsPayload),
        (status = 400, description = "Unknown provider"),
    )
)]
pub async fn save_ai_provider(
    _ctx: Require<IsAdmin>,
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    Json(payload): Json<AiSettingsPayload>,
) -> Response {
    if !KNOWN_PROVIDERS.contains(&provider_id.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "Unknown provider")),
        ).into_response();
    }

    let api_key = if payload.api_key.is_empty() {
        state.repos.get_ai_provider(&provider_id).await
            .map(|c| c.api_key.expose_secret().to_string())
            .unwrap_or_default()
    } else {
        payload.api_key
    };

    let settings = AiSettings {
        provider: provider_id.clone(),
        api_key: SecretString::from(api_key),
        model: payload.model.filter(|m| !m.trim().is_empty()),
        max_tokens: payload.max_tokens,
    };
    state.repos.set_ai_provider(&provider_id, &settings).await;

    data_response(to_payload(&settings)).into_response()
}

#[utoipa::path(delete, path = "/v1/settings/ai/providers/{provider_id}", tag = "Settings",
    params(("provider_id" = String, Path, description = "Provider ID")),
    responses(
        (status = 204, description = "Provider deleted"),
        (status = 400, description = "Unknown provider"),
    )
)]
pub async fn delete_ai_provider(
    _ctx: Require<IsAdmin>,
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Response {
    if !KNOWN_PROVIDERS.contains(&provider_id.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "Unknown provider")),
        ).into_response();
    }
    state.repos.delete_ai_provider(&provider_id).await;
    StatusCode::NO_CONTENT.into_response()
}

// ── Internal: resolve AI provider with raw key (server-to-server) ─────────

#[derive(serde::Deserialize)]
pub struct ResolveAiQuery {
    pub provider: Option<String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ResolveAiResponse {
    pub provider: String,
    pub api_key: String,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
}

#[utoipa::path(get, path = "/v1/internal/ai/resolve", tag = "Internal",
    params(("provider" = Option<String>, Query, description = "Provider ID")),
    responses(
        (status = 200, description = "AI settings with raw key", body = ResolveAiResponse),
        (status = 404, description = "No AI provider configured"),
    )
)]
pub async fn resolve_ai_provider(
    _ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<ResolveAiQuery>,
) -> Response {
    let settings = if let Some(pid) = &query.provider {
        state.repos.get_ai_provider(pid).await
    } else {
        state.repos.list_ai_providers().await.into_iter().next()
    };

    match settings {
        Some(s) if !s.api_key.expose_secret().is_empty() => {
            data_response(ResolveAiResponse {
                provider: s.provider,
                api_key: s.api_key.expose_secret().to_string(),
                model: s.model,
                max_tokens: s.max_tokens,
            }).into_response()
        }
        _ => (
            StatusCode::NOT_FOUND,
            Json(error_body("ai_not_configured", "No AI provider configured. Add one in Settings > AI.")),
        ).into_response(),
    }
}

fn to_payload(s: &AiSettings) -> AiSettingsPayload {
    AiSettingsPayload {
        provider: s.provider.clone(),
        api_key: if s.api_key.expose_secret().is_empty() { String::new() } else { "••••".into() },
        model: s.model.clone(),
        max_tokens: s.max_tokens,
    }
}

// ── Catalog Storage (Promotor) ───────────────────────────────────────────

#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct CatalogStoragePayload {
    pub connector_id: String,
    pub base_url: String,
}

#[utoipa::path(get, path = "/v1/settings/catalog-storage", tag = "Settings",
    responses(
        (status = 200, description = "Catalog storage config", body = CatalogStoragePayload),
        (status = 204, description = "Not configured"),
    )
)]
pub async fn get_catalog_storage(
    _ctx: Require<IsPromotor>,
    State(state): State<AppState>,
) -> Response {
    let settings = state.repos.get_org_settings().await;
    match settings {
        Some(s) if s.catalog_connector_id.is_some() && s.catalog_base_url.is_some() => {
            data_response(CatalogStoragePayload {
                connector_id: s.catalog_connector_id.unwrap(),
                base_url: s.catalog_base_url.unwrap(),
            }).into_response()
        }
        _ => StatusCode::NO_CONTENT.into_response(),
    }
}

#[utoipa::path(put, path = "/v1/settings/catalog-storage", tag = "Settings",
    request_body = CatalogStoragePayload,
    responses(
        (status = 200, description = "Catalog storage saved", body = CatalogStoragePayload),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn save_catalog_storage(
    ctx: Require<IsPromotor>,
    State(state): State<AppState>,
    Json(payload): Json<CatalogStoragePayload>,
) -> Response {
    if payload.connector_id.trim().is_empty() || payload.base_url.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "connector_id and base_url are required")),
        ).into_response();
    }

    // Verify connector exists for the promotor's org
    if state.repos.get_connector(&ctx.resource(&payload.connector_id)).await.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "Connector not found")),
        ).into_response();
    }

    let mut settings = state.repos.get_org_settings().await.unwrap_or_default();
    settings.catalog_connector_id = Some(payload.connector_id.clone());
    settings.catalog_base_url = Some(payload.base_url.clone());
    state.repos.set_org_settings(&settings).await;

    data_response(payload).into_response()
}
