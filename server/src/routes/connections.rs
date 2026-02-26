use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

use crate::cloud::reader;
use crate::settings::types::{CreateConnectionRequest, LocationType, UpdateConnectionRequest};
use crate::tenant::TenantScoped;
use crate::AppState;

use super::error_response;

/// Phase 1 placeholder — Phase 4 middleware replaces this with real session context.
fn placeholder_ctx() -> crate::tenant::TenantContext {
    TenantScoped::placeholder()
}

/// Phase 1 placeholder scoped around a value — Phase 4 middleware replaces this.
fn placeholder_scoped<T: Clone>(inner: T) -> TenantScoped<T> {
    TenantScoped::placeholder_with(inner)
}

#[derive(Deserialize)]
pub struct ListConnectionsQuery {
    #[serde(rename = "type")]
    pub connection_type: Option<String>,
}

pub async fn list_connections(
    State(state): State<AppState>,
    Query(query): Query<ListConnectionsQuery>,
) -> Response {
    let connections = state.db.list_connections(&placeholder_ctx(), query.connection_type.as_deref()).await;
    Json(connections).into_response()
}

pub async fn create_connection(
    State(state): State<AppState>,
    Json(req): Json<CreateConnectionRequest>,
) -> Response {
    if req.location_type == LocationType::Cloud
        && let Some(ref account_id) = req.cloud_account_id
    {
        let creds = state.db.env_snapshot(&placeholder_ctx(), std::slice::from_ref(account_id)).await;
        if let Err(msg) = reader::list_files(&req.url, &creds).await {
            return error_response(
                StatusCode::BAD_REQUEST,
                "CONTAINER_NOT_FOUND",
                format!("Cannot access container '{}': {msg}", req.url),
            );
        }
    }

    match state.db.create_connection(&placeholder_ctx(), req).await {
        Ok(connection) => (StatusCode::CREATED, Json(connection)).into_response(),
        Err(msg) => error_response(StatusCode::BAD_REQUEST, "INVALID_CONNECTION", msg),
    }
}

pub async fn get_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    match state.db.get_connection(&placeholder_scoped(id.as_str())).await {
        Some(connection) => Json(connection).into_response(),
        None => error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "Connection not found"),
    }
}

pub async fn update_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateConnectionRequest>,
) -> Response {
    match state.db.update_connection(&placeholder_scoped(id.as_str()), req).await {
        Ok(connection) => Json(connection).into_response(),
        Err(msg) => error_response(StatusCode::BAD_REQUEST, "INVALID_CONNECTION", msg),
    }
}

pub async fn delete_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    state.db.remove_connection(&placeholder_scoped(id.as_str())).await;
    StatusCode::NO_CONTENT.into_response()
}

pub async fn list_connection_files(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let connection = match state.db.get_connection(&placeholder_scoped(id.as_str())).await {
        Some(s) => s,
        None => return error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "Connection not found"),
    };

    if connection.location_type == LocationType::Local {
        return error_response(
            StatusCode::BAD_REQUEST,
            "UNSUPPORTED",
            "File listing not supported for local connections",
        );
    }

    let account_id = match &connection.cloud_account_id {
        Some(id) => id.clone(),
        None => {
            return error_response(
                StatusCode::BAD_REQUEST,
                "NO_ACCOUNT",
                "Connection has no cloud account",
            )
        }
    };

    let creds = state.db.env_snapshot(&placeholder_ctx(), std::slice::from_ref(&account_id)).await;
    match reader::list_files(&connection.url, &creds).await {
        Ok(files) => Json(files).into_response(),
        Err(msg) => error_response(StatusCode::BAD_GATEWAY, "CLOUD_ERROR", msg),
    }
}
