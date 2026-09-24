use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::AppState;
use crate::cloud::reader;
use crate::connections::models::{Connection, CreateConnectionRequest, Direction, LocationType};
use crate::discovery::routes::{DatasetUrlsRequest, sign_dataset_paths};
use crate::error::data_response;
use crate::middleware::tenant::{IsDataPlane, Require, TenantRole};

use super::errors::ConnectionError;

/// Resolve a cloud connection and its credentials.
async fn resolve_cloud_connection(
    state: &AppState,
    id: &str,
) -> Result<(Connection, HashMap<String, String>), ConnectionError> {
    let connection = state
        .db
        .get_connection(id)
        .await
        .ok_or(ConnectionError::NotFound)?;

    if connection.location_type == LocationType::Local {
        return Err(ConnectionError::InvalidConnection(
            "Operation not supported for local connections".to_string(),
        ));
    }

    let account_id = connection
        .cloud_account_id
        .as_deref()
        .ok_or_else(|| {
            ConnectionError::InvalidConnection("Connection has no cloud account".to_string())
        })?
        .to_string();

    let creds = state
        .db
        .build_storage_config(std::slice::from_ref(&account_id))
        .await;

    Ok((connection, creds))
}

#[derive(Deserialize)]
pub struct ListConnectionsQuery {
    #[serde(rename = "type")]
    pub connection_type: Option<String>,
}

#[utoipa::path(get, path = "/v1/connections", tag = "Connections",
    params(("type" = Option<String>, Query, description = "Filter by connection type")),
    responses((status = 200, description = "List of connections", body = Vec<Connection>))
)]
pub async fn list_connections(
    _ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Query(query): Query<ListConnectionsQuery>,
) -> Result<impl IntoResponse, ConnectionError> {
    let connections = state
        .db
        .list_connections(query.connection_type.as_deref())
        .await;
    Ok(data_response(connections))
}

#[utoipa::path(post, path = "/v1/connections", tag = "Connections",
    request_body = CreateConnectionRequest,
    responses(
        (status = 201, description = "Connection created", body = Connection),
        (status = 400, description = "Invalid connection or container not found"),
    )
)]
pub async fn create_connection(
    ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Json(req): Json<CreateConnectionRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    if req.direction == Direction::Sink && ctx.role != TenantRole::Owner {
        return Err(ConnectionError::Forbidden(
            "only the owner can manage the workspace sink".to_string(),
        ));
    }

    if req.location_type == LocationType::Cloud
        && let Some(ref account_id) = req.cloud_account_id
    {
        let creds = state
            .db
            .build_storage_config(std::slice::from_ref(account_id))
            .await;
        if let Err(msg) = reader::list_files(&req.url, &creds).await {
            return Err(ConnectionError::ContainerNotFound(format!(
                "Cannot access container '{}': {msg}",
                req.url
            )));
        }
    }

    match state.db.create_connection(req).await {
        Ok(connection) => Ok((StatusCode::CREATED, data_response(connection)).into_response()),
        Err(msg) => Err(ConnectionError::InvalidConnection(msg)),
    }
}

#[utoipa::path(get, path = "/v1/connections/{id}", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    responses(
        (status = 200, description = "Connection details", body = Connection),
        (status = 404, description = "Connection not found"),
    )
)]
pub async fn get_connection(
    _ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    match state.db.get_connection(id.as_str()).await {
        Some(connection) => Ok(data_response(connection).into_response()),
        None => Err(ConnectionError::NotFound),
    }
}

#[utoipa::path(delete, path = "/v1/connections/{id}", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    responses(
        (status = 204, description = "Connection deleted"),
    )
)]
pub async fn delete_connection(
    ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    if ctx.role != TenantRole::Owner
        && state
            .db
            .get_connection(id.as_str())
            .await
            .is_some_and(|c| c.direction == Direction::Sink)
    {
        return Err(ConnectionError::Forbidden(
            "only the owner can manage the workspace sink".to_string(),
        ));
    }

    state
        .db
        .remove_connection(id.as_str())
        .await
        .map_err(ConnectionError::Internal)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[utoipa::path(get, path = "/v1/connections/{id}/files", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    responses(
        (status = 200, description = "List of files in the connection", body = Vec<crate::cloud::reader::FileEntry>),
        (status = 400, description = "File listing not supported"),
        (status = 404, description = "Connection not found"),
    )
)]
pub async fn list_connection_files(
    _ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    let (connection, creds) = resolve_cloud_connection(&state, id.as_str()).await?;
    match reader::list_files(&connection.url, &creds).await {
        Ok(files) => Ok(data_response(files).into_response()),
        Err(msg) => Err(ConnectionError::ListFilesFailed(msg)),
    }
}

#[utoipa::path(post, path = "/v1/connections/{id}/urls", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    request_body = DatasetUrlsRequest,
    responses(
        (status = 200, description = "Signed GET URLs, keyed by the requested paths", body = crate::discovery::routes::ResolveResponse),
        (status = 400, description = "Not a source connection, or a path outside it"),
        (status = 404, description = "Connection not found"),
    )
)]
/// Sign GET URLs for files of a source connection, relative to its URL, so the
/// browser can read them before any job exists (the editor describes the
/// sources a program binds). The sink holds every job's output and is read
/// only through the job that wrote it.
pub async fn sign_connection_urls(
    _ctx: Require<IsDataPlane>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<DatasetUrlsRequest>,
) -> Result<Response, ConnectionError> {
    let (connection, creds) = resolve_cloud_connection(&state, id.as_str()).await?;
    if connection.direction != Direction::Source {
        return Err(ConnectionError::InvalidConnection(
            "only a source connection's files can be read directly".to_string(),
        ));
    }
    Ok(
        match sign_dataset_paths(Method::GET, &connection.url, &creds, &req.paths).await {
            Ok(resp) | Err(resp) => resp,
        },
    )
}
