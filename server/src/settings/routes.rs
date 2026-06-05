use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use secrecy::{ExposeSecret, SecretString};

use crate::AppState;
use crate::connections::models::{
    ConnectionKind, CreateConnectionRequest, Direction, LocationType, UpdateConnectionRequest,
};
use crate::error::{data_response, error_body};
use crate::middleware::tenant::{IsMember, IsOwner, Require};
use crate::settings::ai::{AiSettings, AiSettingsPayload};
use crate::settings::org::OrgSettings;
use crate::settings::preferences::Preferences;
use crate::settings::schema::PROVIDER_REGISTRY;

const KNOWN_PROVIDERS: &[&str] = &["anthropic", "openai"];

#[utoipa::path(get, path = "/v1/settings/schema", tag = "Settings",
    responses((status = 200, description = "Provider registry schema", body = Vec<crate::settings::schema::ProviderSchema>))
)]
pub async fn get_schema() -> impl IntoResponse {
    data_response(PROVIDER_REGISTRY)
}

#[utoipa::path(get, path = "/v1/settings/organization", tag = "Settings",
    responses(
        (status = 200, description = "Organization settings", body = OrgSettings),
        (status = 204, description = "No settings configured"),
    )
)]
pub async fn get_org_settings(_ctx: Require<IsMember>, State(state): State<AppState>) -> Response {
    match state.db.get_org_settings().await {
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
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
    Json(payload): Json<OrgSettings>,
) -> Response {
    if payload.publisher_name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "publisher_name is required")),
        ).into_response();
    }
    state.db.set_org_settings(&payload).await;
    data_response(payload).into_response()
}

#[utoipa::path(get, path = "/v1/settings/preferences", tag = "Settings",
    responses((status = 200, description = "UI preferences", body = Preferences))
)]
pub async fn get_preferences(_ctx: Require<IsMember>, State(state): State<AppState>) -> impl IntoResponse {
    data_response(state.db.get_preferences().await)
}

#[utoipa::path(put, path = "/v1/settings/preferences", tag = "Settings",
    request_body = Preferences,
    responses(
        (status = 200, description = "Preferences saved", body = Preferences),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn save_preferences(
    _ctx: Require<IsMember>,
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
    state.db.set_preferences(&payload).await;
    data_response(payload).into_response()
}

#[utoipa::path(get, path = "/v1/settings/ai/providers", tag = "Settings",
    responses((status = 200, description = "List of AI providers", body = Vec<AiSettingsPayload>))
)]
pub async fn list_ai_providers(_ctx: Require<IsMember>, State(state): State<AppState>) -> impl IntoResponse {
    let providers = state.db.list_ai_providers().await;
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
    _ctx: Require<IsMember>,
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
        state.db.get_ai_provider(&provider_id).await
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
    state.db.set_ai_provider(&provider_id, &settings).await;

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
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Response {
    if !KNOWN_PROVIDERS.contains(&provider_id.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "Unknown provider")),
        ).into_response();
    }
    state.db.delete_ai_provider(&provider_id).await;
    StatusCode::NO_CONTENT.into_response()
}

fn to_payload(s: &AiSettings) -> AiSettingsPayload {
    AiSettingsPayload {
        provider: s.provider.clone(),
        api_key: if s.api_key.expose_secret().is_empty() { String::new() } else { "••••".into() },
        model: s.model.clone(),
        max_tokens: s.max_tokens,
    }
}

// ── Catalog Storage (Owner) ───────────────────────────────────────────
//
// The "catalog storage" is the workspace write sink: the single owner-owned
// connection (`direction = sink`) where job output is materialised. This page
// is the dedicated owner surface for it; the connections list shows only
// sources. Both read/write the same `connections` row.

const SINK_NAME: &str = "Workspace output";

#[derive(serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct CatalogStoragePayload {
    pub cloud_account_id: String,
    pub base_url: String,
}

#[utoipa::path(get, path = "/v1/settings/catalog-storage", tag = "Settings",
    responses(
        (status = 200, description = "Catalog storage config", body = CatalogStoragePayload),
        (status = 204, description = "Not configured"),
    )
)]
pub async fn get_catalog_storage(
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
) -> Response {
    match state.db.get_sink_connection().await {
        Some(sink) => match sink.cloud_account_id {
            Some(cloud_account_id) => data_response(CatalogStoragePayload {
                cloud_account_id,
                base_url: sink.url,
            }).into_response(),
            None => StatusCode::NO_CONTENT.into_response(),
        },
        None => StatusCode::NO_CONTENT.into_response(),
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
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
    Json(payload): Json<CatalogStoragePayload>,
) -> Response {
    if payload.cloud_account_id.trim().is_empty() || payload.base_url.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "cloud_account_id and base_url are required")),
        ).into_response();
    }

    // Verify the cloud account exists
    if state.db.get_cloud_account_summary(payload.cloud_account_id.as_str()).await.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(error_body("validation_error", "Cloud account not found")),
        ).into_response();
    }

    let result = match state.db.get_sink_connection().await {
        Some(sink) => state.db.update_connection(&sink.id, UpdateConnectionRequest {
            name: None,
            kind: None,
            location_type: Some(LocationType::Cloud),
            direction: None,
            cloud_account_id: Some(payload.cloud_account_id.clone()),
            url: Some(payload.base_url.clone()),
        }).await.map(|_| ()),
        None => state.db.create_connection(CreateConnectionRequest {
            name: SINK_NAME.to_string(),
            kind: ConnectionKind::Data,
            location_type: LocationType::Cloud,
            direction: Direction::Sink,
            cloud_account_id: Some(payload.cloud_account_id.clone()),
            url: payload.base_url.clone(),
        }).await.map(|_| ()),
    };

    match result {
        Ok(_) => data_response(payload).into_response(),
        Err(msg) => (StatusCode::BAD_REQUEST, Json(error_body("validation_error", msg))).into_response(),
    }
}
