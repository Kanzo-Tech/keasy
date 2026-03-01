use serde_json::{json, Value};

/// Calls POST /openid4vc/verify on the Verifier to create a SIOPv2 session.
/// Returns `{ "id": "<session_id>", "url": "openid4vp://..." }`.
///
/// Uses SIOPv2 (no credential request) so the wallet only needs to prove
/// ownership of its DID — no specific Verifiable Credential required.
/// The Verifier API returns the authorization URL as plain text. The session ID
/// is extracted from the `state` query parameter embedded in that URL.
pub async fn create_verification_session(
    client: &reqwest::Client,
    verifier_url: &str,
) -> Result<Value, String> {
    let resp = client
        .post(format!("{verifier_url}/openid4vc/verify"))
        .header("authorizeBaseUrl", "openid4vp://authorize")
        .header("responseMode", "direct_post")
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| format!("verifier unreachable: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("verifier returned status {status}: {body}"));
    }

    // The Verifier returns the authorization URL as plain text.
    let url = resp
        .text()
        .await
        .map_err(|e| format!("verifier response read: {e}"))?;

    // Extract session ID from the `state` query parameter in the URL.
    let session_id = url
        .split('?')
        .nth(1)
        .and_then(|qs| {
            qs.split('&')
                .find_map(|pair| pair.strip_prefix("state="))
        })
        .ok_or_else(|| "verifier URL missing state parameter".to_string())?;

    Ok(json!({
        "id": session_id,
        "url": url,
    }))
}

/// Polls GET /openid4vc/session/{session_id} on the Verifier.
/// Returns the raw JSON body. The caller checks "verificationResult" field.
/// Returns Err on network error. Returns Ok with the body even if verification is pending.
pub async fn poll_session_status(
    client: &reqwest::Client,
    verifier_url: &str,
    session_id: &str,
) -> Result<Value, String> {
    let resp = client
        .get(format!("{verifier_url}/openid4vc/session/{session_id}"))
        .send()
        .await
        .map_err(|e| format!("verifier poll: {e}"))?;

    // 404 means session expired (in-memory state lost after container restart)
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(json!({ "status": "expired" }));
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("verifier poll response: {e}"))
}

/// Extracts the holder DID from a successful verification response.
///
/// Checks multiple locations in order:
/// 1. `tokenResponse.id_token` — SIOPv2 self-issued ID token (sub/iss = DID)
/// 2. `tokenResponse.vp_token` — OID4VP verifiable presentation (sub/iss = holder DID)
/// 3. `policyResults` — fallback from credential subject
///
/// Falls back to "unknown" if extraction fails (should not happen on a verified session).
pub fn extract_holder_did(body: &Value) -> String {
    let token_response = body.get("tokenResponse");

    // Try id_token first (SIOPv2 — DID auth without credentials)
    if let Some(did) = token_response
        .and_then(|t| t.get("id_token"))
        .and_then(|v| v.as_str())
        .and_then(did_from_jwt)
    {
        return did;
    }

    // Try vp_token (OID4VP — credential presentation)
    if let Some(did) = token_response
        .and_then(|t| t.get("vp_token"))
        .and_then(|v| v.as_str())
        .and_then(did_from_jwt)
    {
        return did;
    }

    // Fallback: look in policyResults for a holder identifier
    if let Some(results) = body
        .get("policyResults")
        .and_then(|p| p.get("results"))
        .and_then(|r| r.as_array())
    {
        for result in results {
            if let Some(holder) = result
                .get("credential")
                .and_then(|c| c.get("credentialSubject"))
                .and_then(|cs| cs.get("id"))
                .and_then(|id| id.as_str())
            {
                return holder.to_string();
            }
        }
    }

    "unknown".to_string()
}

/// Decode a JWT and extract the holder DID from `sub` or `iss` claims.
fn did_from_jwt(token: &str) -> Option<String> {
    let payload_b64 = token.split('.').nth(1)?;
    let decoded = base64_decode_segment(payload_b64).ok()?;
    let payload: Value = serde_json::from_slice(&decoded).ok()?;
    payload
        .get("sub")
        .or_else(|| payload.get("iss"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn base64_decode_segment(segment: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(segment)
        .map_err(|e| format!("base64 decode: {e}"))
}
