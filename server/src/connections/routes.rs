use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::cloud_accounts::reader;
use crate::connections::models::{CreateConnectionRequest, LocationType, UpdateConnectionRequest};
use crate::error::data_response;
use crate::tenant::{placeholder_ctx, placeholder_scoped};
use crate::AppState;

use super::errors::ConnectionError;

#[derive(Deserialize)]
pub struct ListConnectionsQuery {
    #[serde(rename = "type")]
    pub connection_type: Option<String>,
}

pub async fn list_connections(
    State(state): State<AppState>,
    Query(query): Query<ListConnectionsQuery>,
) -> Result<impl IntoResponse, ConnectionError> {
    let connections = state.db.list_connections(&placeholder_ctx(), query.connection_type.as_deref()).await;
    Ok(data_response(connections))
}

pub async fn create_connection(
    State(state): State<AppState>,
    Json(req): Json<CreateConnectionRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    if req.location_type == LocationType::Cloud
        && let Some(ref account_id) = req.cloud_account_id
    {
        let creds = state.db.env_snapshot(&placeholder_ctx(), std::slice::from_ref(account_id)).await;
        if let Err(msg) = reader::list_files(&req.url, &creds).await {
            return Err(ConnectionError::ContainerNotFound(
                format!("Cannot access container '{}': {msg}", req.url),
            ));
        }
    }

    match state.db.create_connection(&placeholder_ctx(), req).await {
        Ok(connection) => Ok((StatusCode::CREATED, data_response(connection)).into_response()),
        Err(msg) => Err(ConnectionError::InvalidConnection(msg)),
    }
}

pub async fn get_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    match state.db.get_connection(&placeholder_scoped(id.as_str())).await {
        Some(connection) => Ok(data_response(connection).into_response()),
        None => Err(ConnectionError::NotFound),
    }
}

pub async fn update_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateConnectionRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    match state.db.update_connection(&placeholder_scoped(id.as_str()), req).await {
        Ok(connection) => Ok(data_response(connection).into_response()),
        Err(msg) => Err(ConnectionError::InvalidConnection(msg)),
    }
}

pub async fn delete_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    state.db.remove_connection(&placeholder_scoped(id.as_str())).await;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn list_connection_files(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    let connection = match state.db.get_connection(&placeholder_scoped(id.as_str())).await {
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

    let creds = state.db.env_snapshot(&placeholder_ctx(), std::slice::from_ref(&account_id)).await;
    match reader::list_files(&connection.url, &creds).await {
        Ok(files) => Ok(data_response(files).into_response()),
        Err(msg) => Err(ConnectionError::ListFilesFailed(msg)),
    }
}
