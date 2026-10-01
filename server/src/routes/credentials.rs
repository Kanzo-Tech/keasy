use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::Deserialize;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::{AnyRole, Member};
use crate::connections::persistence as connections;
use crate::credentials::{named, persistence, probe};
use crate::domain::{CredentialSpecInput, CredentialView, Purpose, ResourceName, ValidationReport};
use crate::error::{ErrorBody, ErrorCode, Refusal};
use crate::startup::AppState;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCredentialRequest {
    pub name: String,
    pub spec: CredentialSpecInput,
    /// A storage URL to LIST before the credential is stored. A storage
    /// credential has no location of its own, so without one it is only
    /// checked to build a client.
    #[serde(default)]
    #[schema(format = "uri")]
    pub probe_url: Option<String>,
}

/// A rename, a rotation or both. `spec` replaces the whole spec, secrets
/// included, and is stored only if every connection using the credential
/// still validates with it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateCredentialRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub spec: Option<CredentialSpecInput>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PurposeQuery {
    /// Only those of this purpose.
    pub purpose: Option<Purpose>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ValidateCredentialRequest {
    /// A storage URL to LIST besides the connections that use the credential.
    #[serde(default)]
    #[schema(format = "uri")]
    pub url: Option<String>,
}

fn may_change(caller: &AnyRole, created_by: &str) -> Result<(), Refusal> {
    if caller.owns(created_by) {
        Ok(())
    } else {
        Err(Refusal::forbidden(
            "only who created a credential, or the owner, may change it",
        ))
    }
}

#[utoipa::path(get, path = "/v1/credentials", tag = "Credentials",
    params(PurposeQuery),
    responses((status = 200, description = "The credentials, with the connections using each; never a secret", body = Vec<CredentialView>))
)]
pub async fn list_credentials(
    _: AnyRole,
    State(state): State<AppState>,
    Query(query): Query<PurposeQuery>,
) -> Result<impl IntoResponse, Refusal> {
    let db = &state.db;
    Ok(Json(persistence::list(
        &*db.read().await,
        db.secret_key(),
        query.purpose,
    )?))
}

#[utoipa::path(post, path = "/v1/credentials", tag = "Credentials",
    request_body = CreateCredentialRequest,
    responses(
        (status = 201, description = "Validated and stored", body = CredentialView),
        (status = 400, description = "An invalid name", body = ErrorBody),
        (status = 409, description = "A credential of that name exists", body = ErrorBody),
        (status = 422, description = "The credential did not validate", body = ErrorBody),
    )
)]
pub async fn create_credential(
    member: Member,
    State(state): State<AppState>,
    Json(request): Json<CreateCredentialRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let view = crate::credentials::create(
        &state.db,
        &request.name,
        &request.spec,
        request.probe_url.as_deref(),
        &member.user_id,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view)))
}

#[utoipa::path(get, path = "/v1/credentials/{name}", tag = "Credentials",
    params(("name" = String, Path, description = "Credential name")),
    responses(
        (status = 200, description = "The credential; never a secret", body = CredentialView),
        (status = 404, description = "No such credential", body = ErrorBody),
    )
)]
pub async fn get_credential(
    _: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    let credential = named(&state.db, &name).await?;
    let used_by = persistence::users_of(&*state.db.read().await, &name)?;
    Ok(Json(credential.view(used_by)))
}

#[utoipa::path(patch, path = "/v1/credentials/{name}", tag = "Credentials",
    params(("name" = String, Path, description = "Credential name")),
    request_body = UpdateCredentialRequest,
    responses(
        (status = 200, description = "Renamed and/or rotated", body = CredentialView),
        (status = 403, description = "Neither its creator nor the owner", body = ErrorBody),
        (status = 404, description = "No such credential", body = ErrorBody),
        (status = 422, description = "A connection using it would not validate with the new spec; `dependents` names them", body = ErrorBody),
    )
)]
/// Rotation replaces the whole spec, and is committed only if every connection
/// using the credential still validates with the new one.
pub async fn update_credential(
    caller: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<UpdateCredentialRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let db = &state.db;
    let current = named(db, &name).await?;
    may_change(&caller, &current.created_by)?;
    let new_name =
        ResourceName::parse(request.name.as_deref().unwrap_or(&name)).map_err(Refusal::invalid)?;

    let (spec, report) = match request.spec {
        Some(spec) => {
            if spec.purpose() != current.spec.purpose() {
                return Err(Refusal::invalid("a credential's purpose cannot change"));
            }
            let dependents = connections::using(&*db.read().await, &name)?;
            let (report, failing) = probe::credential(&spec, None, &dependents).await;
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
        .ok_or_else(|| Refusal::not_found(ErrorCode::CredentialNotFound, "No such credential"))?;
    let used_by = persistence::users_of(&conn, new_name.as_ref())?;
    Ok(Json(stored.view(used_by)))
}

#[utoipa::path(delete, path = "/v1/credentials/{name}", tag = "Credentials",
    params(("name" = String, Path, description = "Credential name")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, description = "Neither its creator nor the owner", body = ErrorBody),
        (status = 404, description = "No such credential", body = ErrorBody),
        (status = 409, description = "Connections still use it; `dependents` names them", body = ErrorBody),
    )
)]
pub async fn delete_credential(
    caller: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    let current = named(&state.db, &name).await?;
    may_change(&caller, &current.created_by)?;
    persistence::delete(&*state.db.write().await, &name)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/v1/credentials/{name}/validate", tag = "Credentials",
    params(("name" = String, Path, description = "Credential name")),
    request_body = ValidateCredentialRequest,
    responses(
        (status = 200, description = "The probe's report, stored with the credential", body = ValidationReport),
        (status = 404, description = "No such credential", body = ErrorBody),
    )
)]
/// Probe the credential through every connection that uses it, and at `url`.
pub async fn validate_credential(
    _: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<ValidateCredentialRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let db = &state.db;
    let credential = named(db, &name).await?;
    let dependents = connections::using(&*db.read().await, &name)?;
    let (report, _) =
        probe::credential(&credential.spec, request.url.as_deref(), &dependents).await;
    persistence::set_validation(&*db.write().await, &name, &report)?;
    Ok(Json(report))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_credentials, create_credential))
        .routes(routes!(
            get_credential,
            update_credential,
            delete_credential
        ))
        .routes(routes!(validate_credential))
}
