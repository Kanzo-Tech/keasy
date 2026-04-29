use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::error::{AppError, data_response};
use crate::middleware::tenant::{IsParticipant, Require};
use crate::AppState;

use super::config::{ConnectorKindInfo, KNOWN_KINDS};
use super::models::{
    ConnectorResponse, CreateConnectorRequest, TestConnectorRequest, UpdateConnectorRequest,
};
use super::service::ConnectorService;

#[derive(Deserialize)]
pub struct ListConnectorsQuery {
    pub direction: Option<String>,
}

#[utoipa::path(get, path = "/v1/connectors", tag = "Connectors",
    params(("direction" = Option<String>, Query, description = "Filter by direction")),
    responses((status = 200, description = "List of connectors", body = Vec<ConnectorResponse>))
)]
pub async fn list_connectors(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Query(query): Query<ListConnectorsQuery>,
) -> impl IntoResponse {
    let svc = ConnectorService::new(state.connectors.clone());
    data_response(svc.list(&ctx.tenant(), query.direction.as_deref()).await)
}

#[utoipa::path(post, path = "/v1/connectors", tag = "Connectors",
    request_body = CreateConnectorRequest,
    responses(
        (status = 201, description = "Connector created", body = ConnectorResponse),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn create_connector(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(req): Json<CreateConnectorRequest>,
) -> Result<impl IntoResponse, AppError> {
    let svc = ConnectorService::new(state.connectors.clone());
    let response = svc.create(&ctx.tenant(), req).await?;
    Ok((StatusCode::CREATED, data_response(response)))
}

#[utoipa::path(get, path = "/v1/connectors/{id}", tag = "Connectors",
    responses(
        (status = 200, description = "Connector details", body = ConnectorResponse),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get_connector(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let svc = ConnectorService::new(state.connectors.clone());
    let response = svc.get(&ctx.resource(&id)).await?;
    Ok(data_response(response))
}

#[utoipa::path(put, path = "/v1/connectors/{id}", tag = "Connectors",
    request_body = UpdateConnectorRequest,
    responses(
        (status = 200, description = "Connector updated", body = ConnectorResponse),
        (status = 404, description = "Not found"),
    )
)]
pub async fn update_connector(
    ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateConnectorRequest>,
) -> Result<impl IntoResponse, AppError> {
    let svc = ConnectorService::new(state.connectors.clone());
    let response = svc.update(&ctx.resource(&id), req).await?;
    Ok(data_response(response))
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
    let svc = ConnectorService::new(state.connectors.clone());
    svc.delete(&ctx.resource(&id)).await?;
    Ok(StatusCode::NO_CONTENT)
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
    let svc = ConnectorService::new(state.connectors.clone());
    svc.test(&ctx.resource(&id)).await?;
    Ok(StatusCode::OK)
}

#[utoipa::path(post, path = "/v1/connectors/test", tag = "Connectors",
    request_body = TestConnectorRequest,
    responses(
        (status = 200, description = "Connection test passed"),
        (status = 400, description = "Connection test failed"),
    )
)]
pub async fn test_connector_config(
    _ctx: Require<IsParticipant>,
    State(state): State<AppState>,
    Json(req): Json<TestConnectorRequest>,
) -> Result<impl IntoResponse, AppError> {
    let svc = ConnectorService::new(state.connectors.clone());
    svc.test_config(&req.config).await?;
    Ok(StatusCode::OK)
}
