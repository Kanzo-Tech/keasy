//! Workspace management endpoints.
//! Member/invite management and identity writes require `Require<IsOwner>`;
//! identity read uses `Require<IsMember>` (any workspace user).
//! These routes live inside `api_routes` (session + tenant context required).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::LazyLock;
use regex::Regex;
use serde::Deserialize;

use crate::AppState;
use crate::error::{data_response, error_body};
use crate::middleware::tenant::{IsMember, IsOwner, RbacError, Require};

static SUBDIVISION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z]{2}-[A-Z0-9]{1,3}$").unwrap());

/// A workspace member, resolved from Keycloak client-role mappings.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct WorkspaceMember {
    pub user_id: String,
    pub role: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub joined_at: String,
}

#[utoipa::path(get, path = "/v1/org/users", tag = "Organization",
    responses((status = 200, description = "List of users in the org", body = Vec<WorkspaceMember>))
)]
pub async fn list_users(
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let (Some(kc), Some(client_id), Some(org_id)) = (
        &state.auth.keycloak_admin,
        &state.auth.oidc_client_id,
        &state.auth.oidc_org_id,
    ) else {
        return Err(RbacError::Internal("Keycloak/organization not configured".to_string()));
    };

    // Members = the organization's members (the canonical membership). Owners
    // are marked by intersecting with the `owner` client-role holders.
    let members = kc.list_org_members(org_id).await.map_err(RbacError::Internal)?;
    let owners: std::collections::HashSet<String> = kc
        .list_client_role_users(client_id, "owner")
        .await
        .map_err(RbacError::Internal)?
        .into_iter()
        .collect();

    let users: Vec<WorkspaceMember> = members
        .into_iter()
        .map(|m| WorkspaceMember {
            role: if owners.contains(&m.user_id) { "owner" } else { "member" }.to_string(),
            user_id: m.user_id,
            email: m.email,
            first_name: m.first_name,
            last_name: m.last_name,
            joined_at: m
                .created_timestamp
                .and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok())
                .map(|t| t.to_string())
                .unwrap_or_default(),
        })
        .collect();

    Ok(data_response(users))
}

#[utoipa::path(delete, path = "/v1/org/users/{id}", tag = "Organization",
    params(("id" = String, Path, description = "User ID")),
    responses(
        (status = 204, description = "User removed"),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn remove_user(
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<impl IntoResponse, RbacError> {
    let (Some(kc), Some(client_id), Some(org_id)) = (
        &state.auth.keycloak_admin,
        &state.auth.oidc_client_id,
        &state.auth.oidc_org_id,
    ) else {
        return Err(RbacError::Internal("Keycloak/organization not configured".to_string()));
    };

    // Revoke both the membership (org) and the authorization (client roles).
    kc.remove_org_member(org_id, &user_id).await.map_err(RbacError::Internal)?;
    kc.remove_client_roles(&user_id, client_id).await.map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Organization identity ────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct OrgIdentityResponse {
    legal_name: String,
    country: String,
    registration_number: Option<String>,
    country_subdivision_code: Option<String>,
    registration_number_type: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UpdateOrgIdentityPayload {
    pub legal_name: String,
    pub country: String,
    pub registration_number: Option<String>,
    pub country_subdivision_code: Option<String>,
    pub registration_number_type: Option<String>,
}

#[utoipa::path(get, path = "/v1/org/identity", tag = "Organization",
    responses(
        (status = 200, description = "Workspace identity", body = OrgIdentityResponse),
    )
)]
pub async fn get_org_identity(
    _ctx: Require<IsMember>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let identity = state.db.get_workspace_identity().await.unwrap_or_default();
    data_response(OrgIdentityResponse {
        legal_name: identity.legal_name,
        country: identity.country,
        registration_number: identity.registration_number,
        country_subdivision_code: identity.country_subdivision_code,
        registration_number_type: identity.registration_number_type,
    })
    .into_response()
}

#[utoipa::path(put, path = "/v1/org/identity", tag = "Organization",
    request_body = UpdateOrgIdentityPayload,
    responses(
        (status = 200, description = "Identity updated", body = OrgIdentityResponse),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn update_org_identity(
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateOrgIdentityPayload>,
) -> Result<impl IntoResponse, RbacError> {
    let legal_name = payload.legal_name.trim().to_string();
    if legal_name.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", "legal_name must not be empty")),
        )
            .into_response());
    }
    if payload.country.len() != 2 {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", "country must be a 2-letter code")),
        )
            .into_response());
    }

    // Validate registration_number_type
    if let Some(ref rnt) = payload.registration_number_type
        && !matches!(rnt.as_str(), "vatID" | "leiCode" | "EORI") {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(error_body("bad_request", "registration_number_type must be vatID, leiCode, or EORI")),
            )
                .into_response());
        }

    // Validate country_subdivision_code (ISO 3166-2: XX-YYY)
    if let Some(ref csc) = payload.country_subdivision_code
        && !SUBDIVISION_RE.is_match(csc) {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(error_body("bad_request", "country_subdivision_code must match ISO 3166-2 (e.g. DE-BY)")),
            )
                .into_response());
        }

    // Read-modify-write so the display `name` (seeded at bootstrap) is preserved.
    let mut identity = state.db.get_workspace_identity().await.unwrap_or_default();
    identity.legal_name = legal_name.clone();
    identity.country = payload.country.clone();
    identity.registration_number = payload.registration_number.clone();
    identity.country_subdivision_code = payload.country_subdivision_code.clone();
    identity.registration_number_type = payload.registration_number_type.clone();
    state.db.set_workspace_identity(&identity).await;

    // Return the updated identity
    Ok(data_response(OrgIdentityResponse {
        legal_name,
        country: payload.country,
        registration_number: payload.registration_number,
        country_subdivision_code: payload.country_subdivision_code,
        registration_number_type: payload.registration_number_type,
    })
    .into_response())
}

// ── Org invite management ────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateOrgInvitePayload {
    pub email: String,
}

/// Invite a person to this workspace by email via a native Keycloak Organization
/// invitation. Keycloak emails them a registration (or confirm-membership) link;
/// on accept they join the org as a member and the tenant grants `member` on their
/// first login. Owner-only.
#[utoipa::path(post, path = "/v1/org/invites", tag = "Organization",
    request_body = CreateOrgInvitePayload,
    responses(
        (status = 204, description = "Invitation sent"),
        (status = 400, description = "Validation error"),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn create_org_invite(
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrgInvitePayload>,
) -> Result<impl IntoResponse, RbacError> {
    let email = payload.email.trim();
    if email.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", "email must not be empty")),
        )
            .into_response());
    }
    let (Some(kc), Some(org_id)) = (&state.auth.keycloak_admin, &state.auth.oidc_org_id) else {
        return Err(RbacError::Internal("Keycloak/organization not configured".to_string()));
    };
    kc.invite_user_to_org(org_id, email)
        .await
        .map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
