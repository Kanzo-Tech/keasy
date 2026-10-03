use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use object_store::ObjectMeta;
use object_store::path::Path as ObjectPath;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::authentication::role::{AnyRole, Member};
use crate::connections::{named, persistence};
use crate::domain::{ConnectionView, ResourceName, StorageTarget, ValidationReport};
use crate::error::{ErrorBody, Refusal};
use crate::startup::AppState;
use crate::storage_client;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateConnectionRequest {
    /// What programs write after `@`, and the connection's key.
    #[schema(value_type = ResourceName)]
    pub name: String,
    /// The credential it signs with.
    pub credential: String,
    pub target: StorageTarget,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct UpdateConnectionRequest {
    #[serde(default)]
    #[schema(value_type = Option<ResourceName>)]
    pub name: Option<String>,
    #[serde(default)]
    pub credential: Option<String>,
    #[serde(default)]
    pub target: Option<StorageTarget>,
}

/// What `GET /v1/connections/{name}/files` lists: a folder under the
/// connection's prefix, and how many objects at most.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct FilesQuery {
    /// A folder under the connection's prefix (`dynamic/`, `a/b`), to list
    /// only what is under it. No `.` or `..` segments.
    pub prefix: Option<String>,
    /// At most this many objects: 1000 when left out, and never more.
    pub limit: Option<usize>,
}

/// The most objects one listing answers: a listing is a page a person reads,
/// not an inventory of the store.
const MAX_FILES: usize = 1000;

/// The objects under a connection's prefix, the first `limit` of them.
#[derive(Debug, Serialize, ToSchema)]
pub struct FileListing {
    pub files: Vec<FileEntry>,
    /// More objects lie under the prefix than were listed.
    pub truncated: bool,
}

/// One object under a connection's prefix.
#[derive(Debug, Serialize, ToSchema)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub last_modified: Option<String>,
}

impl From<ObjectMeta> for FileEntry {
    fn from(meta: ObjectMeta) -> Self {
        Self {
            path: meta.location.to_string(),
            size: meta.size,
            last_modified: Some(meta.last_modified.to_string()),
        }
    }
}

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
            "the owner manages the sink; sources are the members'",
        )),
        None => Ok(()),
        Some(c) if caller.owns(&c.created_by) => Ok(()),
        Some(_) => Err(Refusal::forbidden(
            "only who created a connection, or the owner, may change it",
        )),
    }
}

#[utoipa::path(get, path = "/v1/connections", tag = "Connections",
    responses((status = 200, description = "The connections", body = Vec<ConnectionView>))
)]
pub async fn list_connections(
    _: AnyRole,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Refusal> {
    Ok(Json(persistence::list(&*state.db.read().await)?))
}

#[utoipa::path(post, path = "/v1/connections", tag = "Connections",
    request_body = CreateConnectionRequest,
    responses(
        (status = 201, description = "Validated and stored", body = ConnectionView),
        (status = 400, description = "No such credential, one of the other purpose, or a URL it does not reach", body = ErrorBody),
        (status = 403, description = "A sink by a member, or a source by the owner", body = ErrorBody),
        (status = 409, description = "A connection of that name, or a second sink", body = ErrorBody),
        (status = 422, description = "The connection did not validate", body = ErrorBody),
        (status = 504, description = "The store did not answer the probe in time", body = ErrorBody),
    )
)]
pub async fn create_connection(
    caller: AnyRole,
    State(state): State<AppState>,
    Json(request): Json<CreateConnectionRequest>,
) -> Result<impl IntoResponse, Refusal> {
    may_change(&caller, None, request.target.is_sink())?;
    let view = crate::connections::create(
        &state.db,
        request.name,
        request.credential,
        request.target,
        &caller.user_id,
    )
    .await?;
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
        (status = 504, description = "The store did not answer the probe in time", body = ErrorBody),
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
        (status = 403, description = "Not the caller's to change", body = ErrorBody),
        (status = 404, description = "No such connection", body = ErrorBody),
        (status = 504, description = "The store did not answer the probe in time", body = ErrorBody),
    )
)]
/// LIST a source, WRITE and DELETE under the sink.
pub async fn validate_connection(
    caller: AnyRole,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, Refusal> {
    let connection = named(&state.db, &name).await?;
    // Validating stores the report on the connection: a change, guarded as one.
    may_change(&caller, Some(&connection), connection.target.is_sink())?;
    let credential = crate::credentials::named(&state.db, &connection.credential).await?;
    let report =
        crate::credentials::probe::connection(&credential.spec, &connection.target).await?;
    persistence::set_validation(&*state.db.write().await, &name, &report)?;
    Ok(Json(report))
}

#[utoipa::path(get, path = "/v1/connections/{name}/files", tag = "Connections",
    params(("name" = String, Path, description = "Connection name"), FilesQuery),
    responses(
        (status = 200, description = "The first `limit` objects under the connection's prefix, or under `prefix` within it", body = FileListing),
        (status = 400, description = "Not a storage source, or a prefix that leaves it (`data.field`)", body = ErrorBody),
        (status = 404, description = "No such connection", body = ErrorBody),
        (status = 502, description = "The store refused the listing", body = ErrorBody),
        (status = 504, description = "The store did not answer in time", body = ErrorBody),
    )
)]
pub async fn list_connection_files(
    _: Member,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(query): Query<FilesQuery>,
) -> Result<impl IntoResponse, Refusal> {
    let under = ObjectPath::parse(query.prefix.as_deref().unwrap_or_default())
        .map_err(|e| Refusal::invalid_field("prefix", e.to_string()))?;
    let limit = query.limit.unwrap_or(MAX_FILES).min(MAX_FILES);
    let (url, credential) = {
        let conn = state.db.read().await;
        // The sink is reached through its jobs, here as when a credential is vended.
        let source = crate::connections::source(&conn, &name)?;
        crate::connections::storage(&conn, state.db.secret_key(), &source)?
    };
    let (files, truncated) = storage_client::list_files(&credential, &url, &under, limit).await?;
    Ok(Json(FileListing {
        files: files.into_iter().map(FileEntry::from).collect(),
        truncated,
    }))
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
}
