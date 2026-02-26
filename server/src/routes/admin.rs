//! Promotor-only admin endpoints.
//!
//! All handlers require `RequirePromotor` — non-promotor users receive 403
//! `rbac/insufficient_role`. These routes live inside `api_routes` and are
//! therefore also protected by `session_required` and `tenant_context_required`.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;

use crate::AppState;
use crate::db::dataspaces::{Dataspace, OrgDataspaceMembership, DataspaceRole};
use crate::error::data_response;
use crate::middleware::tenant::{RequirePromotor, RbacError};

// ---------------------------------------------------------------------------
// GET /v1/admin/organizations
// ---------------------------------------------------------------------------

pub async fn list_all_orgs(
    RequirePromotor(_ctx): RequirePromotor,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let orgs = state.db.list_organizations().await;
    Ok(data_response(orgs))
}

// ---------------------------------------------------------------------------
// GET /v1/admin/dataspaces
// ---------------------------------------------------------------------------

pub async fn list_all_dataspaces(
    RequirePromotor(_ctx): RequirePromotor,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let dataspaces = state.db.list_dataspaces().await;
    Ok(data_response(dataspaces))
}

// ---------------------------------------------------------------------------
// POST /v1/admin/dataspaces
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateDataspaceRequest {
    pub name: String,
    pub description: Option<String>,
}

pub async fn create_dataspace(
    RequirePromotor(_ctx): RequirePromotor,
    State(state): State<AppState>,
    Json(payload): Json<CreateDataspaceRequest>,
) -> Result<impl IntoResponse, RbacError> {
    let now = jiff::Timestamp::now().to_string();
    let ds = Dataspace {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.name,
        description: payload.description,
        created_at: now.clone(),
        updated_at: now,
    };
    state
        .db
        .create_dataspace(&ds)
        .await
        .map_err(|e| RbacError::Internal(e))?;
    Ok((StatusCode::CREATED, data_response(ds)))
}

// ---------------------------------------------------------------------------
// POST /v1/admin/organizations/{org_id}/dataspaces
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AddOrgToDataspaceRequest {
    pub dataspace_id: String,
    pub role: String,
}

pub async fn add_org_to_dataspace(
    RequirePromotor(_ctx): RequirePromotor,
    State(state): State<AppState>,
    Path(org_id): Path<String>,
    Json(payload): Json<AddOrgToDataspaceRequest>,
) -> Result<impl IntoResponse, RbacError> {
    let role = DataspaceRole::from_str(&payload.role);
    let membership = OrgDataspaceMembership {
        id: uuid::Uuid::new_v4().to_string(),
        org_id,
        dataspace_id: payload.dataspace_id,
        role,
        created_at: jiff::Timestamp::now().to_string(),
    };
    state
        .db
        .add_org_to_dataspace(&membership)
        .await
        .map_err(|e| RbacError::Internal(e))?;
    Ok(StatusCode::CREATED)
}

// ---------------------------------------------------------------------------
// DELETE /v1/admin/organizations/{org_id}/dataspaces/{ds_id}
// ---------------------------------------------------------------------------

pub async fn remove_org_from_dataspace(
    RequirePromotor(_ctx): RequirePromotor,
    State(state): State<AppState>,
    Path((org_id, ds_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, RbacError> {
    state
        .db
        .remove_org_from_dataspace(&org_id, &ds_id)
        .await
        .map_err(|e| RbacError::Internal(e))?;
    Ok(StatusCode::NO_CONTENT)
}
