//! The workspace's legal identity: read by both roles (the member's job studio
//! reads it to know whether DCAT output can be published), written by the owner.
//! Membership itself is Keycloak's, declared in Terraform.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use regex::Regex;
use std::sync::LazyLock;

use crate::AppState;
use crate::auth::role::{AnyRole, Owner};
use crate::error::{data_response, error_body};
use crate::settings::org::OrgIdentity;

static SUBDIVISION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z]{2}-[A-Z0-9]{1,3}$").unwrap());

#[utoipa::path(get, path = "/v1/org/identity", tag = "Organization",
    responses(
        (status = 200, description = "Workspace identity", body = OrgIdentity),
    )
)]
pub async fn get_org_identity(_: AnyRole, State(state): State<AppState>) -> impl IntoResponse {
    let workspace = state.db.get_workspace_identity().await.unwrap_or_default();
    data_response(workspace.identity).into_response()
}

#[utoipa::path(put, path = "/v1/org/identity", tag = "Organization",
    request_body = OrgIdentity,
    responses(
        (status = 200, description = "Identity updated", body = OrgIdentity),
        (status = 400, description = "Validation error"),
    )
)]
pub async fn update_org_identity(
    _: Owner,
    State(state): State<AppState>,
    Json(mut payload): Json<OrgIdentity>,
) -> Response {
    payload.legal_name = payload.legal_name.trim().to_string();
    let invalid = |message: &str| {
        (
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", message)),
        )
            .into_response()
    };
    if payload.legal_name.is_empty() {
        return invalid("legal_name must not be empty");
    }
    if payload.country.len() != 2 {
        return invalid("country must be a 2-letter code");
    }
    if let Some(ref rnt) = payload.registration_number_type
        && !matches!(rnt.as_str(), "vatID" | "leiCode" | "EORI")
    {
        return invalid("registration_number_type must be vatID, leiCode, or EORI");
    }
    if let Some(ref csc) = payload.country_subdivision_code
        && !SUBDIVISION_RE.is_match(csc)
    {
        return invalid("country_subdivision_code must match ISO 3166-2 (e.g. DE-BY)");
    }

    // Read-modify-write so the display `name` (seeded at bootstrap) is preserved.
    let mut workspace = state.db.get_workspace_identity().await.unwrap_or_default();
    workspace.identity = payload.clone();
    state.db.set_workspace_identity(&workspace).await;

    data_response(payload).into_response()
}
