use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::error::data_response;
use crate::middleware::tenant::{IsParticipant, Require};
use crate::AppState;

use super::error::ConnectorError;
use super::models::{Connector, CreateConnectorRequest, UpdateConnectorRequest};
use super::storage::FileEntry;
use super::types::{ConnectorKindInfo, KNOWN_KINDS};

#[derive(Deserialize)]
pub struct ListConnectorsQuery {
    pub direction: Option<String>,
}

#[utoipa::path(get, path = "/v1/connectors", tag = "Connectors",
    params(("direction" = Option<String>, Query, description = "Filter by direction")),
    responses((status = 200, description = "List of connectors", body = Vec<Connector>))
)]
pub async fn list_connectors(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Query(query): Query<ListConnectorsQuery>,
) -> impl IntoResponse {
    let connectors: Vec<_> = state
        .repos
        .list_connectors(&ctx.tenant(), query.direction.as_deref())
        .await
        .into_iter()
        .map(|c| c.into_redacted())
        .collect();
    data_response(connectors)
}

#[utoipa::path(post, path = "/v1/connectors", tag = "Connectors",
    request_body = CreateConnectorRequest,
    responses(
        (status = 201, description = "Connector created", body = Connector),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn create_connector(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(req): Json<CreateConnectorRequest>,
) -> Result<impl IntoResponse, ConnectorError> {
    req.validate()
        .map_err(ConnectorError::ValidationFailed)?;

    super::test::test_connection(&req.config).await?;

    let connector = state
        .repos
        .create_connector(&ctx.tenant(), req)
        .await
        .map_err(ConnectorError::Internal)?;

    Ok((StatusCode::CREATED, data_response(connector)))
}

#[utoipa::path(get, path = "/v1/connectors/{id}", tag = "Connectors",
    responses(
        (status = 200, description = "Connector details", body = Connector),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get_connector(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectorError> {
    let connector = state
        .repos
        .get_connector(&ctx.resource(&id))
        .await
        .ok_or(ConnectorError::NotFound)?
        .into_redacted();
    Ok(data_response(connector))
}

#[utoipa::path(put, path = "/v1/connectors/{id}", tag = "Connectors",
    request_body = UpdateConnectorRequest,
    responses(
        (status = 200, description = "Connector updated", body = Connector),
        (status = 404, description = "Not found"),
    )
)]
pub async fn update_connector(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateConnectorRequest>,
) -> Result<impl IntoResponse, ConnectorError> {
    let connector = state
        .repos
        .update_connector(&ctx.resource(&id), req)
        .await
        .map_err(ConnectorError::Internal)?
        .ok_or(ConnectorError::NotFound)?;
    Ok(data_response(connector))
}

#[utoipa::path(delete, path = "/v1/connectors/{id}", tag = "Connectors",
    responses(
        (status = 204, description = "Connector deleted"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn delete_connector(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectorError> {
    if state.repos.delete_connector(&ctx.resource(&id)).await {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ConnectorError::NotFound)
    }
}

#[utoipa::path(get, path = "/v1/connectors/kinds", tag = "Connectors",
    responses((status = 200, description = "Available connector kinds", body = Vec<ConnectorKindInfo>))
)]
pub async fn list_connector_kinds() -> impl IntoResponse {
    data_response(KNOWN_KINDS)
}

#[utoipa::path(get, path = "/v1/connectors/{id}/files", tag = "Connectors",
    responses(
        (status = 200, description = "Files in storage", body = Vec<FileEntry>),
        (status = 404, description = "Connector not found"),
    )
)]
pub async fn list_connector_files(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectorError> {
    let connector = state
        .repos
        .get_connector_full(&ctx.resource(&id))
        .await
        .ok_or(ConnectorError::NotFound)?;

    let files = super::storage::list_files(&connector)
        .await
        .map_err(ConnectorError::Internal)?;
    Ok(data_response(files))
}

#[utoipa::path(post, path = "/v1/connectors/{id}/test", tag = "Connectors",
    responses(
        (status = 200, description = "Connection test passed"),
        (status = 400, description = "Connection test failed"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn test_connector(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ConnectorError> {
    let connector = state
        .repos
        .get_connector_full(&ctx.resource(&id))
        .await
        .ok_or(ConnectorError::NotFound)?;
    let cc = connector
        .parse_config()
        .map_err(ConnectorError::ValidationFailed)?;
    super::test::test_connection(&cc).await?;
    Ok(StatusCode::OK)
}

use super::schema::{SchemaEntry, SchemaRequest};

#[utoipa::path(post, path = "/v1/connectors/{id}/schema", tag = "Connectors",
    params(("id" = String, Path, description = "Connector ID")),
    request_body = SchemaRequest,
    responses(
        (status = 200, description = "File schemas", body = std::collections::HashMap<String, SchemaEntry>),
        (status = 404, description = "Connector not found"),
    )
)]
pub async fn post_connector_schema(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<SchemaRequest>,
) -> Result<impl IntoResponse, ConnectorError> {
    let connector = state
        .repos
        .get_connector_full(&ctx.resource(&id))
        .await
        .ok_or(ConnectorError::NotFound)?;

    let mut results = std::collections::HashMap::new();
    for path in &req.paths {
        results.insert(
            path.clone(),
            SchemaEntry {
                columns: vec![],
                error: Some("Schema inference not yet reimplemented".to_string()),
            },
        );
    }
    let _ = connector;

    Ok(crate::error::data_response(results))
}
