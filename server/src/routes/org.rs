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
use crate::db::invite_tokens::InviteToken;
use crate::db::org_members::OrgMember;
use crate::error::{data_response, error_body};
use crate::middleware::session_auth::AuthenticatedUser;
use crate::middleware::tenant::{IsMember, IsOwner, RbacError, Require};

static SUBDIVISION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z]{2}-[A-Z0-9]{1,3}$").unwrap());

#[utoipa::path(get, path = "/v1/org/users", tag = "Organization",
    responses((status = 200, description = "List of users in the org", body = Vec<OrgMember>))
)]
pub async fn list_users(
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let users = state.db.list_org_members().await;
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
    state
        .db
        .remove_org_member(&user_id)
        .await
        .map_err(RbacError::Internal)?;
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

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct OrgInviteEntry {
    pub token: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct CreateOrgInviteResponse {
    pub token: String,
    pub invite_url: String,
}

/// Create a reusable, Discord-style invite link. No body: joining via the link
/// always grants `member`. The link is valid for 7 days and reusable.
#[utoipa::path(post, path = "/v1/org/invites", tag = "Organization",
    responses(
        (status = 201, description = "Invite created", body = CreateOrgInviteResponse),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn create_org_invite(
    _ctx: Require<IsOwner>,
    axum::Extension(auth_user): axum::Extension<AuthenticatedUser>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let now = jiff::Timestamp::now().to_string();
    let token_value = uuid::Uuid::new_v4().to_string();
    let expires_at = {
        let ts = jiff::Timestamp::now();
        ts.checked_add(jiff::SignedDuration::from_hours(7 * 24))
            .unwrap_or(ts)
            .to_string()
    };

    let invite = InviteToken {
        token: token_value.clone(),
        created_by: auth_user.user_id.clone(),
        expires_at,
        created_at: now,
    };
    state
        .db
        .create_invite_token(&invite)
        .await
        .map_err(RbacError::Internal)?;

    let invite_url = format!("{}/invite?token={}", state.base_url, token_value);
    Ok((
        StatusCode::CREATED,
        data_response(CreateOrgInviteResponse {
            token: token_value,
            invite_url,
        }),
    ))
}

#[utoipa::path(get, path = "/v1/org/invites", tag = "Organization",
    responses((status = 200, description = "List of org invite tokens", body = Vec<OrgInviteEntry>))
)]
pub async fn list_org_invites(
    _ctx: Require<IsOwner>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    let tokens = state.db.list_invite_tokens().await;
    let now = jiff::Timestamp::now().to_string();
    let result: Vec<OrgInviteEntry> = tokens
        .into_iter()
        .map(|t| {
            let status = if now > t.expires_at { "expired" } else { "active" };
            OrgInviteEntry {
                token: t.token,
                status: status.to_string(),
                created_at: t.created_at,
                expires_at: t.expires_at,
            }
        })
        .collect();
    Ok(data_response(result))
}

#[utoipa::path(delete, path = "/v1/org/invites/{token}", tag = "Organization",
    params(("token" = String, Path, description = "Invite token to revoke")),
    responses(
        (status = 204, description = "Invite revoked"),
        (status = 403, description = "Insufficient role"),
    )
)]
pub async fn revoke_org_invite(
    _ctx: Require<IsOwner>,
    Path(token): Path<String>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, RbacError> {
    state
        .db
        .delete_invite_token(&token)
        .await
        .map_err(RbacError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}
