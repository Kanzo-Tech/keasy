use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

use crate::AppState;
use crate::cloud::reader;
use crate::settings::types::SaveConnectionRequest;

use super::error_response;

pub async fn list_connections(
    State(state): State<AppState>,
) -> Response {
    let conns = state.connections.list();
    Json(conns).into_response()
}

pub async fn create_connection(
    State(state): State<AppState>,
    Json(req): Json<SaveConnectionRequest>,
) -> Response {
    // Validate cloud_account_id exists
    if state.cloud_accounts.get(&req.cloud_account_id).is_none() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "INVALID_ACCOUNT",
            format!("Cloud account not found: {}", req.cloud_account_id),
        );
    }
    match state.connections.save(req) {
        Ok(conn) => (StatusCode::CREATED, Json(conn)).into_response(),
        Err(msg) => error_response(StatusCode::BAD_REQUEST, "INVALID_CONNECTION", msg),
    }
}

pub async fn delete_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    state.connections.remove(&id);
    StatusCode::NO_CONTENT.into_response()
}

pub async fn list_connection_files(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let conn = match state.connections.get(&id) {
        Some(c) => c,
        None => return error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "Connection not found"),
    };
    let creds = state.cloud_accounts.env_snapshot(&[conn.cloud_account_id.clone()]);
    match reader::list_files(&conn.container_url, &creds).await {
        Ok(files) => Json(files).into_response(),
        Err(msg) => error_response(StatusCode::BAD_GATEWAY, "CLOUD_ERROR", msg),
    }
}

#[derive(Deserialize)]
pub struct DownloadQuery {
    pub path: String,
}

pub async fn download_file(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<DownloadQuery>,
) -> Response {
    let conn = match state.connections.get(&id) {
        Some(c) => c,
        None => return error_response(StatusCode::NOT_FOUND, "NOT_FOUND", "Connection not found"),
    };
    let creds = state.cloud_accounts.env_snapshot(&[conn.cloud_account_id.clone()]);
    match reader::download_file(&conn.container_url, &query.path, &creds).await {
        Ok(bytes) => {
            let content = String::from_utf8_lossy(&bytes).into_owned();
            Json(serde_json::json!({ "content": content })).into_response()
        }
        Err(msg) => error_response(StatusCode::BAD_GATEWAY, "CLOUD_ERROR", msg),
    }
}
