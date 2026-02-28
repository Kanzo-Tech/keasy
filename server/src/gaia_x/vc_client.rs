use serde_json::{json, Value};

/// Calls POST /openid4vc/verify on the Verifier to create a new OID4VP session.
/// Returns the raw JSON body containing "id" (session_id) and "url" (openid4vp:// URL).
pub async fn create_verification_session(
    client: &reqwest::Client,
    verifier_url: &str,
) -> Result<Value, String> {
    let resp = client
        .post(format!("{verifier_url}/openid4vc/verify"))
        .header("authorizeBaseUrl", "openid4vp://authorize")
        .header("responseMode", "direct_post")
        .json(&json!({
            "vp_policies": ["signature", "expired"],
            "vc_policies": ["signature", "expired"],
            "request_credentials": [
                { "type": "VerifiableId", "format": "jwt_vc_json" }
            ]
        }))
        .send()
        .await
        .map_err(|e| format!("verifier unreachable: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("verifier returned status {}", resp.status()));
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("verifier response parse: {e}"))
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
/// Looks in tokenResponse.vp_token or policyResults for the holder subject.
/// Falls back to "unknown" if extraction fails (should not happen on a verified session).
pub fn extract_holder_did(body: &Value) -> String {
    // Try tokenResponse first — contains the VP token with holder info
    if let Some(vp_token) = body
        .get("tokenResponse")
        .and_then(|t| t.get("vp_token"))
        .and_then(|v| v.as_str())
    {
        // The VP token is typically a JWT — the subject (sub) claim is the holder DID
        // For JWTs: header.payload.signature — decode payload
        let parts: Vec<&str> = vp_token.split('.').collect();
        if parts.len() >= 2 {
            if let Ok(decoded) = base64_decode_segment(parts[1]) {
                if let Ok(payload) = serde_json::from_slice::<Value>(&decoded) {
                    if let Some(sub) = payload
                        .get("sub")
                        .or_else(|| payload.get("iss"))
                        .and_then(|v| v.as_str())
                    {
                        return sub.to_string();
                    }
                }
            }
        }
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

fn base64_decode_segment(segment: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(segment)
        .map_err(|e| format!("base64 decode: {e}"))
}
