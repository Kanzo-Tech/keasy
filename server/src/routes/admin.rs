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
use crate::db::dataspaces::{Dataspace, DataspaceRole, OrgDataspaceMembership};
use crate::db::invite_tokens::InviteToken;
use crate::db::organizations::Organization;
use crate::error::data_response;
use crate::middleware::session_auth::AuthenticatedUser;
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
// POST /v1/admin/organizations — create org + invite token + send email
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateOrgAndInviteRequest {
    pub name: String,
    pub admin_email: String,
}

/// POST /v1/admin/organizations — create org, generate invite token, send invite email.
pub async fn create_org_and_invite(
    RequirePromotor(ctx): RequirePromotor,
    axum::Extension(auth_user): axum::Extension<AuthenticatedUser>,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrgAndInviteRequest>,
) -> Result<impl IntoResponse, RbacError> {
    let now = jiff::Timestamp::now().to_string();

    // 1. Create organization — use name as legal_name, "EU" as country placeholder
    let org = Organization {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.name.clone(),
        legal_name: payload.name.clone(),
        registration_number: None,
        country: "EU".to_string(),
        vc_verified_at: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    state
        .db
        .create_organization(&org)
        .await
        .map_err(RbacError::Internal)?;

    // 2. Add org to active dataspace as participant
    let membership = OrgDataspaceMembership {
        id: uuid::Uuid::new_v4().to_string(),
        org_id: org.id.clone(),
        dataspace_id: ctx.dataspace_id.clone(),
        role: DataspaceRole::Participant,
        created_at: now.clone(),
    };
    state
        .db
        .add_org_to_dataspace(&membership)
        .await
        .map_err(RbacError::Internal)?;

    // 3. Create invite token (7-day expiry)
    let token_value = uuid::Uuid::new_v4().to_string();
    let expires_at = {
        let ts = jiff::Timestamp::now();
        ts.checked_add(jiff::SignedDuration::from_hours(7 * 24))
            .unwrap_or(ts)
            .to_string()
    };
    let invite = InviteToken {
        token: token_value.clone(),
        email: Some(payload.admin_email.clone()),
        org_id: org.id.clone(),
        role: "admin".to_string(),
        created_by: auth_user.user_id.clone(),
        used_at: None,
        expires_at,
        created_at: now,
    };
    state
        .db
        .create_invite_token(&invite)
        .await
        .map_err(RbacError::Internal)?;

    // 4. Send invite email — fire-and-forget via tokio::spawn to not block response
    let email_service = state.email_service.clone();
    let to = payload.admin_email.clone();
    let base_url = state.base_url.clone();
    let org_name = payload.name.clone();
    tokio::spawn(async move {
        if let Err(e) = email_service
            .send_invite_email(&to, &token_value, &base_url, &org_name)
            .await
        {
            tracing::error!(to = %to, error = %e, "failed to send invite email");
        }
    });

    // 5. Return created org
    Ok((
        StatusCode::CREATED,
        data_response(serde_json::json!({
            "id": org.id,
            "name": org.name,
            "status": "pending",
        })),
    ))
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
    RequirePromotor(ctx): RequirePromotor,
    State(state): State<AppState>,
    Json(payload): Json<CreateDataspaceRequest>,
) -> Result<impl IntoResponse, RbacError> {
    let now = jiff::Timestamp::now().to_string();
    let ds = Dataspace {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.name,
        description: payload.description,
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    state
        .db
        .create_dataspace(&ds)
        .await
        .map_err(RbacError::Internal)?;

    // Auto-assign the promotor's org as promotor of the new dataspace
    let promotor_membership = OrgDataspaceMembership {
        id: uuid::Uuid::new_v4().to_string(),
        org_id: ctx.org_id.0.clone(),
        dataspace_id: ds.id.clone(),
        role: DataspaceRole::Promotor,
        created_at: now,
    };
    state
        .db
        .add_org_to_dataspace(&promotor_membership)
        .await
        .map_err(RbacError::Internal)?;

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
        .map_err(RbacError::Internal)?;
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
        .map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// GET /v1/admin/dataspace/organizations
// ---------------------------------------------------------------------------

/// GET /v1/admin/dataspace/organizations — list orgs in the caller's active dataspace.
pub async fn list_orgs_in_active_dataspace(
    RequirePromotor(ctx): RequirePromotor,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let orgs = state.db.list_orgs_in_dataspace(&ctx.dataspace_id).await;
    Ok(data_response(orgs))
}
