use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::ai_model::{self, AiModelView};
use crate::authentication::role::{Admin, Reader};
use crate::error::{Problem, Refusal};
use crate::startup::AppState;

/// The workspace's model, as every member may see it.
#[derive(Debug, Serialize, ToSchema)]
pub struct AiModelSettings {
    /// The external model Ask and the assistant call, or `null` while they run
    /// on the model in the page.
    pub external: Option<AiModelView>,
}

/// An external model for the whole workspace.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetAiModelRequest {
    /// The root of an OpenAI-compatible API, `http` or `https`.
    #[schema(format = "uri")]
    pub base_url: String,
    /// The model to call, as the provider names it.
    pub model: String,
    /// The key the provider takes. Left out, the stored one is kept; empty, the
    /// model is called with none, as a local Ollama is.
    #[serde(default)]
    #[schema(value_type = Option<String>, format = Password, write_only)]
    pub api_key: Option<SecretString>,
}

/// The longest model name taken: a provider's names are far shorter.
const MODEL_MAX: usize = 200;

/// `raw` as the root every call is sent under: an `http` or `https` URL with no
/// query, fragment or credentials of its own, without its trailing `/`.
fn base_url(raw: &str) -> Result<String, Refusal> {
    let trimmed = raw.trim();
    let url = url::Url::parse(trimmed)
        .map_err(|e| Refusal::invalid_field("base_url", format!("not a URL: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(Refusal::invalid_field("base_url", "only http and https"));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(Refusal::invalid_field(
            "base_url",
            "a root, with no query or fragment",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(Refusal::invalid_field(
            "base_url",
            "the key goes in api_key, not the URL",
        ));
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

fn model(raw: &str) -> Result<String, Refusal> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(Refusal::invalid_field("model", "a model is required"));
    }
    if trimmed.chars().count() > MODEL_MAX {
        return Err(Refusal::invalid_field(
            "model",
            format!("at most {MODEL_MAX} characters"),
        ));
    }
    Ok(trimmed.to_string())
}

#[utoipa::path(get, path = "/v1/ai/model", tag = "AI", security(("bearer" = ["reader"])),
    responses((status = 200, description = "The workspace's external model, or none; never its key", body = AiModelSettings))
)]
/// Every member reads which model their Ask and assistant run on.
pub async fn get_ai_model(
    _: Reader,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Refusal> {
    let db = &state.db;
    let external = ai_model::get(&*db.read().await, db.secret_key())?;
    Ok(Json(AiModelSettings {
        external: external.map(|m| m.view()),
    }))
}

#[utoipa::path(put, path = "/v1/ai/model", tag = "AI", security(("bearer" = ["admin"])),
    request_body = SetAiModelRequest,
    responses(
        (status = 200, description = "Stored, the key sealed", body = AiModelView),
        (status = 400, description = "Not an http(s) root, or no model", body = Problem, content_type = "application/problem+json"),
    )
)]
/// An admin sets the workspace's external model; every member's calls go to it.
pub async fn set_ai_model(
    caller: Admin,
    State(state): State<AppState>,
    Json(request): Json<SetAiModelRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let base_url = base_url(&request.base_url)?;
    let model = model(&request.model)?;
    let db = &state.db;
    let conn = db.write().await;
    let api_key = match request.api_key {
        None => ai_model::get(&conn, db.secret_key())?.and_then(|m| m.api_key),
        Some(key) => {
            let key = key.expose_secret().trim();
            (!key.is_empty()).then(|| SecretString::from(key))
        }
    };
    ai_model::put(
        &conn,
        db.secret_key(),
        &base_url,
        &model,
        api_key.as_ref(),
        &caller.actor(),
    )?;
    let stored = ai_model::get(&conn, db.secret_key())?.ok_or_else(Refusal::internal)?;
    Ok(Json(stored.view()))
}

#[utoipa::path(delete, path = "/v1/ai/model", tag = "AI", security(("bearer" = ["admin"])),
    responses((status = 204, description = "Removed, or there was none: Ask and the assistant run on the model in the page"))
)]
/// An admin removes the external model, key and all.
pub async fn delete_ai_model(
    _: Admin,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Refusal> {
    ai_model::delete(&*state.db.write().await)?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_ai_model, set_ai_model, delete_ai_model))
}
