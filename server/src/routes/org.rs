//! Workspace management endpoints.
//! Member/invite management and identity writes require `Require<IsOwner>`;
//! identity read uses `Require<IsMember>` (any workspace user).
//! These routes live inside `api_routes` (session + tenant context required).

use axum::{
    extract::State,
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

// Membership (who is owner/member) is declared in Terraform and assigned in Keycloak,
// not managed at runtime — so there are no list/remove/invite endpoints here. This
// module keeps only the workspace's legal identity (company name, country, VAT).

// ── Workspace legal identity ─────────────────────────────────────────────────

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
