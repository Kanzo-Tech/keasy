use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use secrecy::ExposeSecret;

use crate::AppState;
use crate::auth::role::{Member, Owner};
use crate::connections::models::{
    ConnectionKind, CreateConnectionRequest, Direction, LocationType, SINK_NAME,
    UpdateConnectionRequest,
};
use crate::db::DbError;
use crate::error::data_response;
use crate::settings::ai::{AiProvider, AiSettings, AiSettingsPayload, SaveAiProviderRequest};
use crate::settings::org::OrgSettings;
use crate::settings::schema::PROVIDER_REGISTRY;

#[utoipa::path(get, path = "/v1/settings/schema", tag = "Settings",
    responses((status = 200, description = "Provider registry schema", body = Vec<crate::settings::schema::ProviderSchema>))
)]
pub async fn get_schema() -> impl IntoResponse {
    data_response(PROVIDER_REGISTRY)
}

// The DCAT publisher block behind the workspace catalog: catalog metadata, the
// owner's to read and write.
#[utoipa::path(get, path = "/v1/settings/organization", tag = "Settings",
    responses(
        (status = 200, description = "Organization settings", body = OrgSettings),
        (status = 204, description = "No settings configured"),
    )
)]
pub async fn get_org_settings(
    _: Owner,
    State(state): State<AppState>,
) -> Result<Response, DbError> {
    Ok(match state.db.get_org_settings().await? {
        Some(settings) => data_response(settings).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

#[utoipa::path(put, path = "/v1/settings/organization", tag = "Settings",
    request_body = OrgSettings,
    responses(
        (status = 200, description = "Settings saved", body = OrgSettings),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn save_org_settings(
    _: Owner,
    State(state): State<AppState>,
    Json(payload): Json<OrgSettings>,
) -> Result<impl IntoResponse, DbError> {
    if payload.publisher_name.trim().is_empty() {
        return Err(DbError::Invalid("publisher_name is required".into()));
    }
    state.db.set_org_settings(&payload).await?;
    Ok(data_response(payload))
}

// ── AI providers ──────────────────────────────────────────────────────────
//
// An LLM key serves the assistant and the Discovery chat, the member's surfaces
// over the member's own output; the owner has nothing to point a provider at.

#[utoipa::path(get, path = "/v1/settings/ai/providers", tag = "Settings",
    responses((status = 200, description = "List of AI providers", body = Vec<AiSettingsPayload>))
)]
pub async fn list_ai_providers(
    _: Member,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, DbError> {
    let providers = state.db.list_ai_providers().await?;
    Ok(data_response(
        providers.iter().map(to_payload).collect::<Vec<_>>(),
    ))
}

#[utoipa::path(put, path = "/v1/settings/ai/providers/{provider}", tag = "Settings",
    params(("provider" = AiProvider, Path, description = "The provider")),
    request_body = SaveAiProviderRequest,
    responses(
        (status = 200, description = "Provider saved", body = AiSettingsPayload),
        (status = 400, description = "Unknown provider"),
    )
)]
pub async fn save_ai_provider(
    _: Member,
    State(state): State<AppState>,
    Path(provider): Path<AiProvider>,
    Json(payload): Json<SaveAiProviderRequest>,
) -> Result<impl IntoResponse, DbError> {
    let api_key = if payload.api_key.expose_secret().is_empty() {
        state
            .db
            .get_ai_provider(provider)
            .await?
            .map(|c| c.api_key)
            .unwrap_or_default()
    } else {
        payload.api_key
    };

    let settings = AiSettings {
        provider,
        api_key,
        model: payload.model.filter(|m| !m.trim().is_empty()),
        max_tokens: payload.max_tokens,
    };
    state.db.set_ai_provider(&settings).await?;
    Ok(data_response(to_payload(&settings)))
}

#[utoipa::path(delete, path = "/v1/settings/ai/providers/{provider}", tag = "Settings",
    params(("provider" = AiProvider, Path, description = "The provider")),
    responses(
        (status = 204, description = "Provider deleted"),
        (status = 400, description = "Unknown provider"),
    )
)]
pub async fn delete_ai_provider(
    _: Member,
    State(state): State<AppState>,
    Path(provider): Path<AiProvider>,
) -> Result<impl IntoResponse, DbError> {
    state.db.delete_ai_provider(provider).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn to_payload(s: &AiSettings) -> AiSettingsPayload {
    AiSettingsPayload {
        provider: s.provider,
        api_key: if s.api_key.expose_secret().is_empty() {
            String::new()
        } else {
            "••••".into()
        },
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
    _: Owner,
    State(state): State<AppState>,
) -> Result<Response, DbError> {
    Ok(match state.db.get_sink_connection().await? {
        Some(sink) => match sink.cloud_account_id {
            Some(cloud_account_id) => data_response(CatalogStoragePayload {
                cloud_account_id,
                base_url: sink.url,
            })
            .into_response(),
            None => StatusCode::NO_CONTENT.into_response(),
        },
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

#[utoipa::path(put, path = "/v1/settings/catalog-storage", tag = "Settings",
    request_body = CatalogStoragePayload,
    responses(
        (status = 200, description = "Catalog storage saved", body = CatalogStoragePayload),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn save_catalog_storage(
    _: Owner,
    State(state): State<AppState>,
    Json(payload): Json<CatalogStoragePayload>,
) -> Result<impl IntoResponse, DbError> {
    if payload.cloud_account_id.trim().is_empty() || payload.base_url.trim().is_empty() {
        return Err(DbError::Invalid(
            "cloud_account_id and base_url are required".into(),
        ));
    }
    if state
        .db
        .get_cloud_account_summary(&payload.cloud_account_id)
        .await?
        .is_none()
    {
        return Err(DbError::Invalid("Cloud account not found".into()));
    }

    match state.db.get_sink_connection().await? {
        Some(sink) => {
            state
                .db
                .update_connection(
                    &sink.id,
                    UpdateConnectionRequest {
                        name: None,
                        kind: None,
                        location_type: Some(LocationType::Cloud),
                        direction: None,
                        cloud_account_id: Some(payload.cloud_account_id.clone()),
                        url: Some(payload.base_url.clone()),
                    },
                )
                .await?;
        }
        None => {
            state
                .db
                .create_connection(CreateConnectionRequest {
                    name: SINK_NAME.to_string(),
                    kind: ConnectionKind::Data,
                    location_type: LocationType::Cloud,
                    direction: Direction::Sink,
                    cloud_account_id: Some(payload.cloud_account_id.clone()),
                    url: payload.base_url.clone(),
                })
                .await?;
        }
    }
    Ok(data_response(payload))
}
