/// GXDCH (Gaia-X Digital Clearing House) API client.
///
/// Two external API calls:
/// - Notary: obtain a signed LRN (Legal Registration Number) Verifiable Credential
/// - Compliance Service: submit a VP for conformance attestation
///
/// Default URLs target the staging/lab environment. Production endpoints are separate.
/// Both URLs are overridable via KEASY_GXDCH_NOTARY_URL and KEASY_GXDCH_COMPLIANCE_URL.
use serde_json::{Value, json};

/// Default GXDCH Notary URL (v1-staging).
pub const GXDCH_NOTARY_URL: &str =
    "https://registrationnumber.notary.lab.gaia-x.eu/v1-staging/registrationNumberVC";

/// Default GXDCH Compliance Service URL (v1-staging).
pub const GXDCH_COMPLIANCE_URL: &str =
    "https://compliance.lab.gaia-x.eu/v1-staging/api/credential-offers";

/// Request a signed LRN Verifiable Credential from the GXDCH Notary.
///
/// The Notary validates the registration number against external registries:
/// - vatID → VIES (EU VAT)
/// - leiCode → GLEIF
/// - EORI → European Commission
///
/// - `client`: reqwest HTTP client
/// - `notary_url`: base URL for the Notary endpoint (allows override from config)
/// - `domain`: org's public domain (used to build the credential URL)
/// - `lrn_type`: "vatID" | "leiCode" | "EORI"
/// - `lrn_value`: registration number (e.g. "DE123456789")
pub async fn request_lrn_credential(
    client: &reqwest::Client,
    notary_url: &str,
    domain: &str,
    lrn_type: &str,
    lrn_value: &str,
) -> Result<Value, String> {
    let lrn_key = format!("gx:{lrn_type}");
    let vc_id = format!("https://{}/.well-known/lrn.json", domain);

    let body = json!({
        "@context": [
            "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/participant"
        ],
        "type": "gx:legalRegistrationNumber",
        "id": &vc_id,
        lrn_key: lrn_value
    });

    let url = format!("{}?vcid={}", notary_url, urlencoding::encode(&vc_id));

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("GXDCH Notary unreachable: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "GXDCH Notary returned {status}: {err_body}"
        ));
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("failed to parse GXDCH Notary response: {e}"))
}

/// Submit a Verifiable Presentation to the GXDCH Compliance Service.
///
/// On success returns the Compliance Verifiable Credential (JSON-LD).
/// On failure returns an `Err` with the HTTP status and response body for debugging.
///
/// - `client`: reqwest HTTP client
/// - `compliance_url`: Compliance Service endpoint (allows override from config)
/// - `vp`: assembled Verifiable Presentation with all inline credentials
pub async fn submit_compliance(
    client: &reqwest::Client,
    compliance_url: &str,
    vp: &Value,
) -> Result<Value, String> {
    let resp = client
        .post(compliance_url)
        .json(vp)
        .send()
        .await
        .map_err(|e| format!("GXDCH Compliance Service unreachable: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "GXDCH Compliance Service returned {status}: {err_body}"
        ));
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("failed to parse GXDCH Compliance Service response: {e}"))
}
