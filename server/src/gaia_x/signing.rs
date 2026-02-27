/// JsonWebSignature2020 proof generation for Gaia-X credentials.
///
/// Signs a credential JSON-LD value using ECDSA P-256 (ES256) and a detached JWS.
///
/// Canonicalization approach: Uses sorted-key JSON serialization rather than full
/// URDNA2015 canonicalization. Community tools (SovereignCloudStack/gx-credential-generator,
/// deltaDAO/self-description-signer) use this approach and GXDCH Compliance Service
/// currently accepts it on the v1-staging/main endpoints. If GXDCH requires strict
/// URDNA2015, a Node.js sidecar using @gaia-x/json-web-signature-2020 may be needed.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jiff::Timestamp;
use p256::ecdsa::{SigningKey, signature::Signer};
use p256::pkcs8::DecodePrivateKey;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Sign a credential JSON value in-place by adding a `proof` field.
///
/// The proof uses the JsonWebSignature2020 type with a detached JWS:
/// `{header_b64url}..{signature_b64url}` (two consecutive dots = empty payload segment).
///
/// Process:
/// 1. Serialize credential (without proof) as sorted-key canonical JSON
/// 2. Hash with SHA-256
/// 3. Parse private key PEM → SigningKey
/// 4. Build JWS header (alg=ES256, b64=false, crit=["b64"])
/// 5. Sign {header_b64url}.{sha256_bytes}
/// 6. Produce detached JWS and add `proof` to credential
///
/// The private key is accepted in-memory only and immediately dropped. It is NEVER
/// stored or logged (locked decision).
pub fn sign_credential(
    credential: &mut serde_json::Value,
    private_key_pem: &str,
    domain: &str,
) -> Result<(), String> {
    // Step 1: Remove any existing proof, then produce sorted-key canonical JSON.
    credential.as_object_mut().map(|o| o.remove("proof"));

    let canonical = sort_json_keys(credential);
    let canonical_bytes = serde_json::to_vec(&canonical)
        .map_err(|e| format!("failed to serialize credential for signing: {e}"))?;

    // Step 2: SHA-256 hash.
    let digest = Sha256::digest(&canonical_bytes);

    // Step 3: Parse private key PEM.
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem)
        .map_err(|e| format!("failed to parse private key PEM: {e}"))?;

    // Step 4: Build detached JWS header: {"alg":"ES256","b64":false,"crit":["b64"]}
    let header_json = r#"{"alg":"ES256","b64":false,"crit":["b64"]}"#;
    let header_b64 = URL_SAFE_NO_PAD.encode(header_json.as_bytes());

    // Step 5: Sign {header_b64url}.{sha256_digest_bytes}
    // The payload is the raw SHA-256 digest bytes (b64=false means payload is not base64).
    let signing_input: Vec<u8> = {
        let mut v = format!("{header_b64}.").into_bytes();
        v.extend_from_slice(&digest);
        v
    };

    let signature: p256::ecdsa::Signature = signing_key.sign(&signing_input);
    let sig_bytes: Vec<u8> = signature.to_bytes().to_vec();
    let sig_b64 = URL_SAFE_NO_PAD.encode(&sig_bytes);

    // Step 6: Detached JWS = {header_b64url}..{signature_b64url} (empty payload segment)
    let jws = format!("{header_b64}..{sig_b64}");

    let created = Timestamp::now().to_string();
    let verification_method = format!("did:web:{domain}#key-1");

    credential["proof"] = serde_json::json!({
        "type": "JsonWebSignature2020",
        "created": created,
        "proofPurpose": "assertionMethod",
        "verificationMethod": verification_method,
        "jws": jws
    });

    Ok(())
}

/// Recursively sort JSON object keys to produce canonical JSON for signing.
///
/// Uses BTreeMap ordering (alphabetical) to ensure deterministic key order.
/// Arrays are preserved in order; nested objects have their keys sorted recursively.
fn sort_json_keys(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let sorted: BTreeMap<String, serde_json::Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), sort_json_keys(v)))
                .collect();
            serde_json::Value::Object(sorted.into_iter().collect())
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(sort_json_keys).collect())
        }
        other => other.clone(),
    }
}
