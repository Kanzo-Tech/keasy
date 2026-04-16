use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use futures::StreamExt;
use serde::Deserialize;

use crate::error::{AppError, data_response};
use crate::middleware::tenant::{IsParticipant, Require};
use crate::AppState;

use super::models::{Connector, CreateConnectorRequest, UpdateConnectorRequest};
use super::types::{ConnectorConfig, ConnectorKindInfo, KNOWN_KINDS};

async fn test_connection(config: &ConnectorConfig) -> Result<(), AppError> {
    let (store, prefix) = config
        .build_store()
        .map_err(|msg| AppError::Validation(format!("connection test: {msg}")))?;
    let list_prefix = if prefix.as_ref().is_empty() {
        None
    } else {
        Some(&prefix)
    };
    let mut stream = store.list(list_prefix);
    match stream.next().await {
        Some(Ok(_)) | None => Ok(()),
        Some(Err(e)) => Err(AppError::Validation(format!("connection test: {e}"))),
    }
}

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
) -> Result<impl IntoResponse, AppError> {
    req.validate()
        .map_err(AppError::Validation)?;

    test_connection(&req.config).await?;

    let connector = state
        .repos
        .create_connector(&ctx.tenant(), req)
        .await
        .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?;

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
) -> Result<impl IntoResponse, AppError> {
    let connector = state
        .repos
        .get_connector(&ctx.resource(&id))
        .await
        .ok_or(AppError::NotFound)?
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
) -> Result<impl IntoResponse, AppError> {
    let connector = state
        .repos
        .update_connector(&ctx.resource(&id), req)
        .await
        .map_err(|msg| AppError::Internal(anyhow::anyhow!(msg)))?
        .ok_or(AppError::NotFound)?;
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
) -> Result<impl IntoResponse, AppError> {
    if state.repos.delete_connector(&ctx.resource(&id)).await {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}

#[utoipa::path(get, path = "/v1/connectors/kinds", tag = "Connectors",
    responses((status = 200, description = "Available connector kinds", body = Vec<ConnectorKindInfo>))
)]
pub async fn list_connector_kinds() -> impl IntoResponse {
    data_response(KNOWN_KINDS)
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
) -> Result<impl IntoResponse, AppError> {
    let connector = state
        .repos
        .get_connector_full(&ctx.resource(&id))
        .await
        .ok_or(AppError::NotFound)?;
    let cc = connector
        .parse_config()
        .map_err(AppError::Validation)?;
    test_connection(&cc).await?;
    Ok(StatusCode::OK)
}
