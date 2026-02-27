/// P-256 (secp256r1) key pair generation.
///
/// The private key is returned to the caller as PKCS#8 PEM for download.
/// It is NEVER stored in the database (locked decision).
/// Only the public key JWK is persisted in wizard state.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use p256::ecdsa::SigningKey;
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey};
// Use OsRng from rand_core 0.6 — compatible with p256 0.13 which uses rand_core 0.6 internally.
use rand_core06::OsRng;

/// Output of key pair generation.
pub struct GeneratedKeyPair {
    /// PKCS#8 PEM-encoded private key — returned to client for download, never stored.
    pub private_key_pem: String,
    /// Public key as JWK — stored in gaia_x_wizard_state.
    pub public_key_jwk: serde_json::Value,
}

/// Generate a fresh P-256 key pair.
///
/// Returns the private key PEM (for client download) and the public key JWK
/// (for server storage and DID document embedding).
pub fn generate_key_pair() -> Result<GeneratedKeyPair, String> {
    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    // Export private key as PKCS#8 PEM — handed to client, not stored.
    let private_key_pem = signing_key
        .to_pkcs8_pem(p256::pkcs8::LineEnding::LF)
        .map_err(|e| format!("failed to encode private key as PKCS#8 PEM: {e}"))?
        .to_string();

    // Export public key as JWK: extract uncompressed point (04 || x || y).
    let point = verifying_key.to_encoded_point(false);
    let x = point.x().ok_or("P-256 public key missing x coordinate")?;
    let y = point.y().ok_or("P-256 public key missing y coordinate")?;

    let public_key_jwk = serde_json::json!({
        "kty": "EC",
        "crv": "P-256",
        "x": URL_SAFE_NO_PAD.encode(x),
        "y": URL_SAFE_NO_PAD.encode(y),
    });

    Ok(GeneratedKeyPair {
        private_key_pem,
        public_key_jwk,
    })
}

/// Verify that a PEM-encoded private key matches a stored public key JWK.
///
/// Used in steps 4 and 5 when the user re-uploads their private key for signing.
/// Parses the PEM back to a SigningKey, derives the public JWK, and compares
/// x and y fields with the stored JWK.
pub fn verify_key_match(
    private_pem: &str,
    stored_jwk: &serde_json::Value,
) -> Result<(), String> {
    let signing_key = SigningKey::from_pkcs8_pem(private_pem)
        .map_err(|e| format!("failed to parse private key PEM: {e}"))?;

    let verifying_key = signing_key.verifying_key();
    let point = verifying_key.to_encoded_point(false);
    let x = point.x().ok_or("P-256 public key missing x coordinate")?;
    let y = point.y().ok_or("P-256 public key missing y coordinate")?;

    let derived_x = URL_SAFE_NO_PAD.encode(x);
    let derived_y = URL_SAFE_NO_PAD.encode(y);

    let stored_x = stored_jwk
        .get("x")
        .and_then(|v| v.as_str())
        .ok_or("stored JWK missing x field")?;
    let stored_y = stored_jwk
        .get("y")
        .and_then(|v| v.as_str())
        .ok_or("stored JWK missing y field")?;

    if derived_x != stored_x || derived_y != stored_y {
        return Err(
            "private key does not match the stored public key — upload the correct key".into(),
        );
    }

    Ok(())
}
