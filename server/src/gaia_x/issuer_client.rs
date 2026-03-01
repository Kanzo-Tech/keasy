/// OID4VCI issuer client — creates credential offers via the walt.id Issuer API.

use serde_json::Value;

/// Create a credential offer via the walt.id Issuer API.
/// Returns the OID4VCI offer URL that the wallet scans.
pub async fn create_credential_offer(
    client: &reqwest::Client,
    issuer_url: &str,
    credential: &Value,
) -> Result<String, String> {
    let url = format!(
        "{}/openid4vc/jwt/issue",
        issuer_url.trim_end_matches('/')
    );

    let payload = serde_json::json!({
        "credentialData": credential,
        "mapping": null
    });

    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("issuer request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("issuer API returned {status}: {body}"));
    }

    // The walt.id issuer API returns the offer URL as plain text
    let offer_url = resp
        .text()
        .await
        .map_err(|e| format!("failed to read issuer response: {e}"))?;

    if offer_url.trim().is_empty() {
        return Err("issuer returned empty offer URL".to_string());
    }

    Ok(offer_url.trim().to_string())
}
