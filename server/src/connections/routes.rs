use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::cloud::reader;
use crate::connections::models::{
    ColumnInfo, Connection, CreateConnectionRequest, FileSchemaResponse, LocationType,
    UpdateConnectionRequest, UploadFileRequest,
};
use crate::error::data_response;
use crate::middleware::tenant::{IsMember, Require};
use crate::AppState;

use super::errors::ConnectionError;

use std::collections::HashMap;

/// Resolve a cloud connection and its credentials. Shared by list_files, upload, and schema.
async fn resolve_cloud_connection(
    state: &AppState,
    ctx: &crate::middleware::tenant::TenantContext,
    id: &str,
) -> Result<(Connection, HashMap<String, String>), ConnectionError> {
    let connection = state
        .db
        .get_connection(&ctx.scoped(id))
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
        .build_storage_config(&ctx.as_ctx(), std::slice::from_ref(&account_id))
        .await;

    Ok((connection, creds))
}

fn join_connection_path(base: &str, path: &str) -> Result<String, String> {
    let base_canonical = std::path::PathBuf::from(base)
        .canonicalize()
        .map_err(|e| format!("Invalid base path: {e}"))?;
    let full_path = base_canonical
        .join(path)
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !full_path.starts_with(&base_canonical) {
        return Err("Path traversal not allowed".into());
    }
    Ok(full_path.to_string_lossy().to_string())
}

#[derive(Deserialize)]
pub struct ListConnectionsQuery {
    #[serde(rename = "type")]
    pub connection_type: Option<String>,
}

#[derive(Deserialize)]
pub struct SchemaQuery {
    pub path: String,
}

#[utoipa::path(get, path = "/v1/connections", tag = "Connections",
    params(("type" = Option<String>, Query, description = "Filter by connection type")),
    responses((status = 200, description = "List of connections", body = Vec<Connection>))
)]
pub async fn list_connections(
    ctx: Require<IsMember>,
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
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Json(req): Json<CreateConnectionRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    if req.location_type == LocationType::Cloud
        && let Some(ref account_id) = req.cloud_account_id
    {
        let creds = state.db.build_storage_config(&ctx.as_ctx(), std::slice::from_ref(account_id)).await;
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
    ctx: Require<IsMember>,
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
    ctx: Require<IsMember>,
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
    ctx: Require<IsMember>,
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
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectionError> {
    let (connection, creds) = resolve_cloud_connection(&state, &ctx, id.as_str()).await?;
    match reader::list_files(&connection.url, &creds).await {
        Ok(files) => Ok(data_response(files).into_response()),
        Err(msg) => Err(ConnectionError::ListFilesFailed(msg)),
    }
}

#[utoipa::path(put, path = "/v1/connections/{id}/files", tag = "Connections",
    params(("id" = String, Path, description = "Connection ID")),
    request_body = UploadFileRequest,
    responses(
        (status = 204, description = "File uploaded"),
        (status = 400, description = "Upload not supported"),
        (status = 404, description = "Connection not found"),
        (status = 502, description = "Upload failed"),
    )
)]
pub async fn upload_file(
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UploadFileRequest>,
) -> Result<impl IntoResponse, ConnectionError> {
    let (connection, creds) = resolve_cloud_connection(&state, &ctx, id.as_str()).await?;
    let url = join_connection_path(&connection.url, &req.path)
        .map_err(ConnectionError::InvalidConnection)?;
    reader::upload(&url, req.content.into_bytes(), &creds)
        .await
        .map_err(ConnectionError::UploadFailed)?;

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[utoipa::path(get, path = "/v1/connections/{id}/schema", tag = "Connections",
    params(
        ("id" = String, Path, description = "Connection ID"),
        ("path" = String, Query, description = "Relative file path within the connection"),
    ),
    responses(
        (status = 200, description = "File schema", body = FileSchemaResponse),
        (status = 400, description = "Schema inference failed or unsupported file type"),
        (status = 404, description = "Connection not found"),
    )
)]
pub async fn get_file_schema(
    ctx: Require<IsMember>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<SchemaQuery>,
) -> Result<impl IntoResponse, ConnectionError> {
    let ext = query.path.rsplit('.').next().unwrap_or("").to_lowercase();
    if ext != "csv" {
        return Err(ConnectionError::SchemaInferenceFailed(
            format!("Unsupported file type: .{ext}. Only .csv is supported."),
        ));
    }

    let connection = state
        .db
        .get_connection(&ctx.scoped(id.as_str()))
        .await
        .ok_or(ConnectionError::NotFound)?;

    let url = join_connection_path(&connection.url, &query.path)
        .map_err(ConnectionError::InvalidConnection)?;

    let bytes = if connection.location_type == LocationType::Cloud {
        let (_, creds) = resolve_cloud_connection(&state, &ctx, id.as_str()).await?;
        reader::download(&url, &creds)
            .await
            .map_err(|e| ConnectionError::SchemaInferenceFailed(format!("Download failed: {e}")))?
    } else {
        tokio::fs::read(&url)
            .await
            .map_err(|e| ConnectionError::SchemaInferenceFailed(format!("Read failed: {e}")))?
    };

    let columns = infer_csv_schema(&bytes)
        .map_err(ConnectionError::SchemaInferenceFailed)?;

    Ok(data_response(FileSchemaResponse { columns }))
}

fn infer_csv_schema(bytes: &[u8]) -> Result<Vec<ColumnInfo>, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(bytes);

    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| format!("Failed to read CSV headers: {e}"))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    if headers.is_empty() {
        return Err("CSV has no columns".to_string());
    }

    // Sample up to 100 rows to infer types
    let mut type_hints: Vec<InferredType> = vec![InferredType::Unknown; headers.len()];
    let mut rows_sampled = 0;

    for result in rdr.records() {
        let record = result.map_err(|e| format!("Failed to read CSV row: {e}"))?;
        for (i, field) in record.iter().enumerate() {
            if i < type_hints.len() {
                type_hints[i] = merge_type(type_hints[i], infer_field_type(field));
            }
        }
        rows_sampled += 1;
        if rows_sampled >= 100 {
            break;
        }
    }

    Ok(headers
        .into_iter()
        .zip(type_hints)
        .map(|(name, t)| ColumnInfo {
            name,
            data_type: t.as_str().to_string(),
        })
        .collect())
}

#[derive(Clone, Copy, PartialEq)]
enum InferredType {
    Unknown,
    Bool,
    Int,
    Float,
    Date,
    String,
}

impl InferredType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unknown | Self::String => "string",
            Self::Bool => "bool",
            Self::Int => "int",
            Self::Float => "float",
            Self::Date => "date",
        }
    }
}

fn infer_field_type(value: &str) -> InferredType {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return InferredType::Unknown;
    }
    if trimmed.eq_ignore_ascii_case("true") || trimmed.eq_ignore_ascii_case("false") {
        return InferredType::Bool;
    }
    if trimmed.parse::<i64>().is_ok() {
        return InferredType::Int;
    }
    if trimmed.parse::<f64>().is_ok() {
        return InferredType::Float;
    }
    // Simple date check: YYYY-MM-DD
    if trimmed.len() >= 10 && trimmed.as_bytes()[4] == b'-' && trimmed.as_bytes()[7] == b'-'
        && trimmed[..4].parse::<u16>().is_ok()
            && trimmed[5..7].parse::<u8>().is_ok()
            && trimmed[8..10].parse::<u8>().is_ok()
        {
            return InferredType::Date;
        }
    InferredType::String
}

fn merge_type(current: InferredType, new: InferredType) -> InferredType {
    match (current, new) {
        (InferredType::Unknown, t) | (t, InferredType::Unknown) => t,
        (a, b) if a == b => a,
        (InferredType::Int, InferredType::Float) | (InferredType::Float, InferredType::Int) => {
            InferredType::Float
        }
        _ => InferredType::String,
    }
}
