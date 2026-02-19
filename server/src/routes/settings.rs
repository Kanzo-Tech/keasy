use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::AppState;
use crate::settings::ai::AiSettings;
use crate::settings::org::OrgSettings;
use crate::settings::preferences::Preferences;
use crate::settings::schema::PROVIDER_REGISTRY;

use super::error_response;

pub async fn get_schema() -> impl IntoResponse {
    Json(PROVIDER_REGISTRY)
}

pub async fn get_org_settings(State(state): State<AppState>) -> Response {
    match state.org_settings.read() {
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
    state.org_settings.write(Some(payload));
    match state.org_settings.read() {
        Some(settings) => (StatusCode::OK, Json(settings)).into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub async fn get_preferences(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.preferences.read())
}

pub async fn save_preferences(
    State(state): State<AppState>,
    Json(payload): Json<Preferences>,
) -> Response {
    for (val, name) in [
        (&payload.shiki_theme, "shiki_theme"),
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
    state.preferences.write(payload);
    (StatusCode::OK, Json(state.preferences.read())).into_response()
}

pub async fn get_ai_settings(State(state): State<AppState>) -> Response {
    match state.ai_settings.read() {
        Some(mut settings) => {
            if !settings.api_key.is_empty() {
                settings.api_key = mask_key(&settings.api_key);
            }
            (StatusCode::OK, Json(settings)).into_response()
        }
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

pub async fn save_ai_settings(
    State(state): State<AppState>,
    Json(payload): Json<AiSettings>,
) -> Response {
    if payload.provider.trim().is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "validation_error", "provider is required");
    }

    let current = state.ai_settings.read();
    let api_key = if payload.api_key.is_empty() || payload.api_key.contains('*') {
        current.map(|c| c.api_key).unwrap_or_default()
    } else {
        payload.api_key
    };

    let settings = AiSettings {
        provider: payload.provider,
        api_key,
        model: payload.model.filter(|m| !m.trim().is_empty()),
    };

    state.ai_settings.write(Some(settings));

    match state.ai_settings.read() {
        Some(mut s) => {
            if !s.api_key.is_empty() {
                s.api_key = mask_key(&s.api_key);
            }
            (StatusCode::OK, Json(s)).into_response()
        }
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn mask_key(key: &str) -> String {
    if key.len() <= 8 {
        "*".repeat(key.len())
    } else {
        format!("{}...{}", &key[..4], &key[key.len() - 4..])
    }
}
