use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::AnyRole;
use crate::connections::persistence as connections;
use crate::credentials::{named, persistence, probe};
use crate::domain::{ResourceName, SecretSpec, SecretView, ValidationReport};
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::startup::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateSecretRequest {
    #[schema(value_type = ResourceName)]
    pub name: String,
    pub spec: SecretSpec,
    /// A storage URL to LIST before the secret is stored. A secret has
    /// no location of its own, so without one it is only checked to build a
    /// client.
    #[serde(default)]
    #[schema(format = "uri")]
    pub probe_url: Option<String>,
}

/// A rename, a rotation or both. `spec` replaces the whole spec, secrets
/// included, and is stored only if every connection using the secret
/// still validates with it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateSecretRequest {
    #[serde(default)]
    #[schema(value_type = Option<ResourceName>)]
    pub name: Option<String>,
    #[serde(default)]
    pub spec: Option<SecretSpec>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ValidateSecretRequest {
    /// A storage URL to LIST besides the connections that use the secret.
    #[serde(default)]
    #[schema(format = "uri")]
    pub url: Option<String>,
}

fn may_change(caller: &AnyRole, created_by: &str) -> Result<(), Refusal> {
    if caller.owns(created_by) {
        Ok(())
    } else {
        Err(Refusal::forbidden(
            "only who created a secret, or the owner, may change it",
        ))
    }
}

#[utoipa::path(get, path = "/v1/secrets", tag = "Secrets",
    responses((status = 200, description = "The secrets, with the connections using each; never a secret's value", body = Vec<SecretView>))
)]
pub async fn list_secrets(
    _: AnyRole,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Refusal> {
    let db = &state.db;
    Ok(Json(persistence::list(&*db.read().await, db.secret_key())?))
}

#[utoipa::path(post, path = "/v1/secrets", tag = "Secrets",
    request_body = CreateSecretRequest,
    responses(
        (status = 201, description = "Validated and stored", body = SecretView),
        (status = 400, description = "An invalid name", body = ErrorBody),
        (status = 409, description = "A secret of that name exists", body = ErrorBody),
        (status = 422, description = "The secret did not validate", body = ErrorBody),
        (status = 504, description = "The store did not answer the probe in time", body = ErrorBody),
    )
)]
/// Any role may create one: a member for their sources, the owner for the
/// sink — and either may change or delete what they made.
pub async fn create_secret(
    caller: AnyRole,
    State(state): State<AppState>,
    Json(request): Json<CreateSecretRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let view = crate::credentials::create(
        &state.db,
        &request.name,
        &request.spec,
        request.probe_url.as_deref(),
        &caller.user_id,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view)))
}

#[utoipa::path(get, path = "/v1/secrets/{name}", tag = "Secrets",
    params(("name" = String, Path, description = "Secret name")),
    responses(
        (status = 200, description = "The secret; never its value", body = SecretView),
        (status = 404, description = "No such secret", body = ErrorBody),
    )
)]
pub async fn get_secret(
    _: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    let credential = named(&state.db, &name).await?;
    let used_by = persistence::users_of(&*state.db.read().await, &name)?;
    Ok(Json(credential.view(used_by)))
}

#[utoipa::path(patch, path = "/v1/secrets/{name}", tag = "Secrets",
    params(("name" = String, Path, description = "Secret name")),
    request_body = UpdateSecretRequest,
    responses(
        (status = 200, description = "Renamed and/or rotated", body = SecretView),
        (status = 403, description = "Neither its creator nor the owner", body = ErrorBody),
        (status = 404, description = "No such secret", body = ErrorBody),
        (status = 422, description = "A connection using it would not validate with the new spec; `dependents` names them", body = ErrorBody),
        (status = 504, description = "The store did not answer the probe in time", body = ErrorBody),
    )
)]
/// Rotation replaces the whole spec, and is committed only if every connection
/// using the secret still validates with the new one.
pub async fn update_secret(
    caller: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<UpdateSecretRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let db = &state.db;
    let current = named(db, &name).await?;
    may_change(&caller, &current.created_by)?;
    let new_name = ResourceName::parse(request.name.as_deref().unwrap_or(&name))
        .map_err(|e| Refusal::invalid_field("name", e))?;

    let (spec, report) = match request.spec {
        Some(spec) => {
            let dependents = connections::using(&*db.read().await, &name)?;
            let (report, failing) = probe::credential(&spec, None, &dependents).await?;
            if !report.passed() {
                return Err(Refusal::probe_failed(
                    format!("the new spec was not stored: {}", report.failures()),
                    failing,
                ));
            }
            (spec, Some(report))
        }
        None => (current.spec, None),
    };

    let conn = db.write().await;
    persistence::update(
        &conn,
        db.secret_key(),
        &name,
        &new_name,
        &spec,
        &caller.user_id,
        report.as_ref(),
    )?;
    let stored = persistence::get(&conn, db.secret_key(), new_name.as_ref())?
        .ok_or_else(|| Refusal::not_found(ErrorCode::SecretNotFound, "No such secret"))?;
    let used_by = persistence::users_of(&conn, new_name.as_ref())?;
    Ok(Json(stored.view(used_by)))
}

#[utoipa::path(delete, path = "/v1/secrets/{name}", tag = "Secrets",
    params(("name" = String, Path, description = "Secret name")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, description = "Neither its creator nor the owner", body = ErrorBody),
        (status = 404, description = "No such secret", body = ErrorBody),
        (status = 409, description = "Connections still use it; `dependents` names them", body = ErrorBody),
    )
)]
pub async fn delete_secret(
    caller: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    let current = named(&state.db, &name).await?;
    may_change(&caller, &current.created_by)?;
    persistence::delete(&*state.db.write().await, &name)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/v1/secrets/{name}/validate", tag = "Secrets",
    params(("name" = String, Path, description = "Secret name")),
    request_body = ValidateSecretRequest,
    responses(
        (status = 200, description = "The probe's report, stored with the secret", body = ValidationReport),
        (status = 403, description = "Neither its creator nor the owner", body = ErrorBody),
        (status = 404, description = "No such secret", body = ErrorBody),
        (status = 504, description = "The store did not answer the probe in time", body = ErrorBody),
    )
)]
/// Probe the secret through every connection that uses it, and at `url`.
pub async fn validate_secret(
    caller: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<ValidateSecretRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let db = &state.db;
    let credential = named(db, &name).await?;
    // Validating stores the report on the secret: a change, guarded as one.
    may_change(&caller, &credential.created_by)?;
    let dependents = connections::using(&*db.read().await, &name)?;
    let (report, _) =
        probe::credential(&credential.spec, request.url.as_deref(), &dependents).await?;
    persistence::set_validation(&*db.write().await, &name, &report)?;
    Ok(Json(report))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_secrets, create_secret))
        .routes(routes!(get_secret, update_secret, delete_secret))
        .routes(routes!(validate_secret))
}
