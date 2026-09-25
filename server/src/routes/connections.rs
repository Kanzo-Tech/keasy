use std::collections::HashMap;
use std::collections::hash_map::Entry;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::IntoResponse;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::connections::{
    ConnectionView, CreateConnectionRequest, FileEntry, SignLocatorsRequest, SignLocatorsResponse,
    UpdateConnectionRequest,
};
use crate::api::credentials::{CredentialSpecInput, PurposeQuery, StorageCredentialInput};
use crate::api::validation::ValidationReport;
use crate::api::{ErrorBody, ErrorCode};

use crate::authentication::role::{AnyRole, Member};
use crate::connections::locator::{is_public_http, signer};
use crate::connections::{named, persistence};
use crate::domain::StorageUrl;
use crate::error::Refusal;
use crate::startup::AppState;
use crate::storage_client::{self, SIGNED_URL_EXPIRES};

/// The sink is the owner's alone; every other connection is a member's, and
/// once made, its creator's or the owner's to change.
fn may_change(
    caller: &AnyRole,
    current: Option<&ConnectionView>,
    sink: bool,
) -> Result<(), Refusal> {
    if sink {
        return if caller.is_owner() {
            Ok(())
        } else {
            Err(Refusal::forbidden(
                "only the owner manages the workspace sink",
            ))
        };
    }
    match current {
        None if caller.is_owner() => Err(Refusal::forbidden(
            "the owner manages the sink; sources and models are the members'",
        )),
        None => Ok(()),
        Some(c) if caller.owns(&c.created_by) => Ok(()),
        Some(_) => Err(Refusal::forbidden(
            "only who created a connection, or the owner, may change it",
        )),
    }
}

#[utoipa::path(get, path = "/v1/connections", tag = "Connections",
    params(PurposeQuery),
    responses((status = 200, description = "The connections", body = Vec<ConnectionView>))
)]
pub async fn list_connections(
    _: AnyRole,
    State(state): State<AppState>,
    Query(query): Query<PurposeQuery>,
) -> Result<impl IntoResponse, Refusal> {
    Ok(Json(persistence::list(
        &*state.db.read().await,
        query.purpose,
    )?))
}

#[utoipa::path(post, path = "/v1/connections", tag = "Connections",
    request_body = CreateConnectionRequest,
    responses(
        (status = 201, description = "Validated and stored", body = ConnectionView),
        (status = 400, description = "No such credential, one of the other purpose, or a URL it does not reach", body = ErrorBody),
        (status = 403, description = "A sink by a member, or a source or model by the owner", body = ErrorBody),
        (status = 409, description = "A connection of that name, or a second sink", body = ErrorBody),
        (status = 422, description = "The connection did not validate", body = ErrorBody),
    )
)]
pub async fn create_connection(
    caller: AnyRole,
    State(state): State<AppState>,
    Json(request): Json<CreateConnectionRequest>,
) -> Result<impl IntoResponse, Refusal> {
    may_change(&caller, None, request.target.is_sink())?;
    let view = crate::connections::create(&state.db, request, &caller.user_id).await?;
    Ok((StatusCode::CREATED, Json(view)))
}

#[utoipa::path(get, path = "/v1/connections/{name}", tag = "Connections",
    params(("name" = String, Path, description = "Connection name")),
    responses(
        (status = 200, description = "The connection", body = ConnectionView),
        (status = 404, description = "No such connection", body = ErrorBody),
    )
)]
pub async fn get_connection(
    _: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    Ok(Json(named(&state.db, &name).await?))
}

#[utoipa::path(patch, path = "/v1/connections/{name}", tag = "Connections",
    params(("name" = String, Path, description = "Connection name")),
    request_body = UpdateConnectionRequest,
    responses(
        (status = 200, description = "Validated again and stored", body = ConnectionView),
        (status = 403, description = "Not the caller's to change", body = ErrorBody),
        (status = 404, description = "No such connection", body = ErrorBody),
        (status = 422, description = "The connection did not validate", body = ErrorBody),
    )
)]
pub async fn update_connection(
    caller: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(request): Json<UpdateConnectionRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let current = named(&state.db, &name).await?;
    let mut updated = current.clone();
    if let Some(new_name) = request.name {
        updated.name = new_name;
    }
    if let Some(credential) = request.credential {
        updated.credential = credential;
    }
    if let Some(target) = request.target {
        updated.target = target;
    }
    if updated.target.purpose() != current.target.purpose() {
        return Err(Refusal::invalid("a connection's purpose cannot change"));
    }
    may_change(
        &caller,
        Some(&current),
        current.target.is_sink() || updated.target.is_sink(),
    )?;
    Ok(Json(
        crate::connections::save(&state.db, Some(&name), updated, &caller.user_id).await?,
    ))
}

#[utoipa::path(delete, path = "/v1/connections/{name}", tag = "Connections",
    params(("name" = String, Path, description = "Connection name")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, description = "Not the caller's to delete", body = ErrorBody),
        (status = 404, description = "No such connection", body = ErrorBody),
        (status = 409, description = "Jobs wrote their output to it; `dependents` names them", body = ErrorBody),
    )
)]
pub async fn delete_connection(
    caller: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    let current = named(&state.db, &name).await?;
    may_change(&caller, Some(&current), current.target.is_sink())?;
    persistence::delete(&*state.db.write().await, &name)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/v1/connections/{name}/validate", tag = "Connections",
    params(("name" = String, Path, description = "Connection name")),
    responses(
        (status = 200, description = "The probe's report, stored with the connection", body = ValidationReport),
        (status = 404, description = "No such connection", body = ErrorBody),
    )
)]
/// LIST a source, WRITE and DELETE under the sink, list a model's provider.
pub async fn validate_connection(
    _: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    let connection = named(&state.db, &name).await?;
    let credential = crate::credentials::named(&state.db, &connection.credential).await?;
    let report = crate::credentials::probe::connection(&credential.spec, &connection.target).await;
    persistence::set_validation(&*state.db.write().await, &name, &report)?;
    Ok(Json(report))
}

#[utoipa::path(get, path = "/v1/connections/{name}/files", tag = "Connections",
    params(("name" = String, Path, description = "Connection name")),
    responses(
        (status = 200, description = "Every object under the connection's prefix", body = Vec<FileEntry>),
        (status = 400, description = "Not a storage connection", body = ErrorBody),
        (status = 404, description = "No such connection", body = ErrorBody),
        (status = 502, description = "The store refused the listing", body = ErrorBody),
    )
)]
pub async fn list_connection_files(
    _: Member,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    let connection = named(&state.db, &name).await?;
    let (url, credential) = crate::connections::storage(&state.db, &connection).await?;
    storage_client::list_files(&credential, &url)
        .await
        .map(Json)
        .map_err(|e| Refusal::new(StatusCode::BAD_GATEWAY, ErrorCode::ListFilesFailed, e))
}

#[utoipa::path(post, path = "/v1/connections/urls", tag = "Connections",
    request_body = SignLocatorsRequest,
    responses((status = 200, description = "Signed GET URLs for the locators the caller may read", body = SignLocatorsResponse))
)]
/// Sign GET URLs for locators, each with the credential of the source it lies
/// under. A member reads what every source holds, and the sink only through
/// the job that wrote it. Public HTTP locators come back as they are.
pub async fn sign_locators(
    _: Member,
    State(state): State<AppState>,
    Json(req): Json<SignLocatorsRequest>,
) -> Result<impl IntoResponse, Refusal> {
    let connections = persistence::list(&*state.db.read().await, None)?;
    let mut credentials: HashMap<&str, StorageCredentialInput> = HashMap::new();
    let mut urls = HashMap::with_capacity(req.locators.len());
    let sign_failed =
        |e: String| Refusal::new(StatusCode::INTERNAL_SERVER_ERROR, ErrorCode::SignError, e);
    for locator in &req.locators {
        let Some(conn) = signer(locator, &connections) else {
            if is_public_http(locator) {
                urls.insert(locator.clone(), locator.clone());
            }
            continue;
        };
        let credential = match credentials.entry(conn.credential.as_str()) {
            Entry::Occupied(e) => e.into_mut(),
            Entry::Vacant(e) => match crate::credentials::named(&state.db, &conn.credential)
                .await?
                .spec
            {
                CredentialSpecInput::Storage(spec) => e.insert(spec),
                CredentialSpecInput::Model(_) => continue,
            },
        };
        let url = StorageUrl::parse(locator).map_err(sign_failed)?;
        let store = storage_client::store(credential, &url).map_err(sign_failed)?;
        let signed = store
            .sign_url(Method::GET, url.path(), SIGNED_URL_EXPIRES)
            .await
            .map_err(|e| sign_failed(e.to_string()))?;
        urls.insert(locator.clone(), signed.to_string());
    }
    Ok(Json(SignLocatorsResponse { urls }))
}

/// The routes this module serves.
pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_connections, create_connection))
        .routes(routes!(
            get_connection,
            update_connection,
            delete_connection
        ))
        .routes(routes!(validate_connection))
        .routes(routes!(list_connection_files))
        .routes(routes!(sign_locators))
}
