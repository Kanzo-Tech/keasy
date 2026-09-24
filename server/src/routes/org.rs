//! The workspace's legal identity: read by both roles (the member's job studio
//! reads it to know whether DCAT output can be published), written by the owner.
//! Membership itself is Keycloak's, declared in Terraform.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::AppState;
use crate::auth::role::{AnyRole, Owner};
use crate::db::DbError;
use crate::error::{data_response, error_body};
use crate::settings::org::OrgIdentity;

/// An ISO 3166-2 subdivision code: `XX-Y`, `XX-YY` or `XX-YYY`.
fn is_subdivision(code: &str) -> bool {
    match code.split_once('-') {
        Some((country, region)) => {
            country.len() == 2
                && country.bytes().all(|b| b.is_ascii_uppercase())
                && (1..=3).contains(&region.len())
                && region
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        }
        None => false,
    }
}

#[utoipa::path(get, path = "/v1/org/identity", tag = "Organization",
    responses(
        (status = 200, description = "Workspace identity", body = OrgIdentity),
    )
)]
pub async fn get_org_identity(
    _: AnyRole,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, DbError> {
    let workspace = state.db.get_workspace_identity().await?.unwrap_or_default();
    Ok(data_response(workspace.identity))
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
) -> Result<Response, Response> {
    payload.legal_name = payload.legal_name.trim().to_string();
    let invalid = |message: &str| {
        Err((
            StatusCode::BAD_REQUEST,
            Json(error_body("bad_request", message)),
        )
            .into_response())
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
        && !is_subdivision(csc)
    {
        return invalid("country_subdivision_code must match ISO 3166-2 (e.g. DE-BY)");
    }

    // Read-modify-write so the display `name` (seeded at bootstrap) is preserved.
    let mut workspace = state
        .db
        .get_workspace_identity()
        .await
        .map_err(IntoResponse::into_response)?
        .unwrap_or_default();
    workspace.identity = payload.clone();
    state
        .db
        .set_workspace_identity(&workspace)
        .await
        .map_err(IntoResponse::into_response)?;

    Ok(data_response(payload).into_response())
}

#[cfg(test)]
mod tests {
    use super::is_subdivision;

    #[test]
    fn subdivision_codes_are_iso_3166_2() {
        for ok in ["DE-BY", "ES-M", "FR-75C", "GB-ENG"] {
            assert!(is_subdivision(ok), "{ok}");
        }
        for bad in [
            "", "DE", "de-BY", "DE-", "DE-BAYR", "D-BY", "DE-by", "DEU-BY",
        ] {
            assert!(!is_subdivision(bad), "{bad}");
        }
    }
}
