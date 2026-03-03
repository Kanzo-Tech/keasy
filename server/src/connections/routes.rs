use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::cloud::reader;
use crate::connections::models::{Connection, CreateConnectionRequest, LocationType, UpdateConnectionRequest};
use crate::error::data_response;
use crate::middleware::tenant::RequireParticipant;
use crate::AppState;

use super::errors::ConnectionError;

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
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Query(query): Query<ListConnectionsQuery>,
) -> Result<impl IntoResponse, ConnectionError> {
    let connections = state.db.list_connections(&ctx.as_ctx(), query.connection_type.as_deref()).await;
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
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Json(req): Json<CreateConnectionRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    if req.location_type == LocationType::Cloud
        && let Some(ref account_id) = req.cloud_account_id
    {
        let creds = state.db.env_snapshot(&ctx.as_ctx(), std::slice::from_ref(account_id)).await;
        if let Err(msg) = reader::list_files(&req.url, &creds).await {
            return Err(ConnectionError::ContainerNotFound(
                format!("Cannot access container '{}': {msg}", req.url),
            ));
        }
    }

    match state.db.create_connection(&ctx.as_ctx(), req).await {
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
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    match state.db.get_connection(&ctx.scoped(id.as_str())).await {
        Some(connection) => Ok(data_response(connection).into_response()),
        None => Err(ConnectionError::NotFound),
    }
}

#[utoipa::path(put, path = "/v1/connections/{id}", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    request_body = UpdateConnectionRequest,
    responses(
        (status = 200, description = "Connection updated", body = Connection),
        (status = 400, description = "Invalid connection"),
        (status = 404, description = "Connection not found"),
    )
)]
pub async fn update_connection(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateConnectionRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    match state.db.update_connection(&ctx.scoped(id.as_str()), req).await {
        Ok(connection) => Ok(data_response(connection).into_response()),
        Err(msg) => Err(ConnectionError::InvalidConnection(msg)),
    }
}

#[utoipa::path(delete, path = "/v1/connections/{id}", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    responses(
        (status = 204, description = "Connection deleted"),
    )
)]
pub async fn delete_connection(
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    state.db.remove_connection(&ctx.scoped(id.as_str())).await
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
    RequireParticipant(ctx): RequireParticipant,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    let connection = match state.db.get_connection(&ctx.scoped(id.as_str())).await {
        Some(s) => s,
        None => return Err(ConnectionError::NotFound),
    };

    if connection.location_type == LocationType::Local {
        return Err(ConnectionError::InvalidConnection(
            "File listing not supported for local connections".to_string(),
        ));
    }

    let account_id = match &connection.cloud_account_id {
        Some(id) => id.clone(),
        None => {
            return Err(ConnectionError::InvalidConnection(
                "Connection has no cloud account".to_string(),
            ))
        }
    };

    let creds = state.db.env_snapshot(&ctx.as_ctx(), std::slice::from_ref(&account_id)).await;
    match reader::list_files(&connection.url, &creds).await {
        Ok(files) => Ok(data_response(files).into_response()),
        Err(msg) => Err(ConnectionError::ListFilesFailed(msg)),
    }
}
