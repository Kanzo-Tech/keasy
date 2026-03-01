/// OID4VCI credential export routes.
///
/// POST /v1/gaia-x/credentials/offer — create an OID4VCI credential offer
/// from the org's stored compliance VC.

use axum::{extract::State, response::Response};

use crate::AppState;
use crate::error::{bad_request_response, data_response, internal_error_response};
use crate::gaia_x::{db, issuer_client};
use crate::middleware::tenant::RequireOrgAdmin;

use axum::response::IntoResponse;

#[utoipa::path(post, path = "/v1/gaia-x/credentials/offer", tag = "Gaia-X Credentials",
    responses(
        (status = 200, description = "Credential offer URL created"),
        (status = 400, description = "Issuer not configured or org not compliant"),
    )
)]
pub async fn create_credential_offer(
    RequireOrgAdmin(ctx): RequireOrgAdmin,
    State(state): State<AppState>,
) -> Response {
    // Verify issuer is configured
    let (issuer_client, issuer_url) = match (
        &state.gaia_x.issuer_client,
        &state.gaia_x.walt_id_issuer_url,
    ) {
        (Some(c), Some(u)) => (c.clone(), u.clone()),
        _ => return bad_request_response("Credential issuer is not configured"),
    };

    let org_id = ctx.org_id.0.clone();

    // Load wizard state to get compliance VC
    let (_permit, conn) = state.db.read().await;
    let wizard = match db::get_wizard_state(&conn, &org_id) {
        Ok(Some(w)) => w,
        Ok(None) => return bad_request_response("No compliance credentials — complete the wizard first"),
        Err(e) => return internal_error_response(&format!("db read failed: {e}")),
    };
    drop(conn);
    drop(_permit);

    let compliance_vc_str = match &wizard.compliance_vc {
        Some(vc) => vc.clone(),
        None => return bad_request_response("Organization is not compliant — complete the wizard first"),
    };

    let compliance_vc: serde_json::Value = match serde_json::from_str(&compliance_vc_str) {
        Ok(v) => v,
        Err(e) => return internal_error_response(&format!("failed to parse compliance VC: {e}")),
    };

    // Create credential offer via issuer API
    match issuer_client::create_credential_offer(&issuer_client, &issuer_url, &compliance_vc).await
    {
        Ok(offer_url) => data_response(serde_json::json!({ "offer_url": offer_url })).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to create credential offer");
            internal_error_response(&format!("issuer error: {e}"))
        }
    }
}
