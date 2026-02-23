use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use secrecy::{ExposeSecret, SecretString};

use crate::AppState;
use crate::settings::ai::{AiSettings, AiSettingsPayload};
use crate::settings::org::OrgSettings;
use crate::settings::preferences::Preferences;
use crate::settings::schema::PROVIDER_REGISTRY;

use super::error_response;

pub async fn get_schema() -> impl IntoResponse {
    Json(PROVIDER_REGISTRY)
}

pub async fn get_org_settings(State(state): State<AppState>) -> Response {
    match state.db.get_org_settings().await {
        Some(settings) => (StatusCode::OK, Json(settings)).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

pub async fn save_org_settings(
    State(state): State<AppState>,
    Json(payload): Json<OrgSettings>,
) -> Response {
    if payload.publisher_name.trim().is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "validation_error", "publisher_name is required");
    }
    state.db.set_org_settings(&payload).await;
    (StatusCode::OK, Json(payload)).into_response()
}

pub async fn get_preferences(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.db.get_preferences().await)
}

pub async fn save_preferences(
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
            return error_response(StatusCode::BAD_REQUEST, "validation_error", format!("{name} is required"));
        }
    }
    state.db.set_preferences(&payload).await;
    (StatusCode::OK, Json(payload)).into_response()
}

pub async fn get_ai_settings(State(state): State<AppState>) -> Response {
    match state.db.get_ai_settings().await {
        Some(s) => (StatusCode::OK, Json(to_payload(&s))).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

pub async fn save_ai_settings(
    State(state): State<AppState>,
    Json(payload): Json<AiSettingsPayload>,
) -> Response {
    if payload.provider.trim().is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "validation_error", "provider is required");
    }

    let api_key = if payload.api_key.is_empty() {
        state.db.get_ai_settings().await
            .map(|c| c.api_key.expose_secret().to_string())
            .unwrap_or_default()
    } else {
        payload.api_key
    };

    let settings = AiSettings {
        provider: payload.provider,
        api_key: SecretString::from(api_key),
        model: payload.model.filter(|m| !m.trim().is_empty()),
        max_tokens: payload.max_tokens,
    };
    state.db.set_ai_settings(&settings).await;

    (StatusCode::OK, Json(to_payload(&settings))).into_response()
}

fn to_payload(s: &AiSettings) -> AiSettingsPayload {
    AiSettingsPayload {
        provider: s.provider.clone(),
        api_key: if s.api_key.expose_secret().is_empty() { String::new() } else { "••••".into() },
        model: s.model.clone(),
        max_tokens: s.max_tokens,
    }
}
