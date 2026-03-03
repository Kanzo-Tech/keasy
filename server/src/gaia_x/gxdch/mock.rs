/// Mock GXDCH client — returns structurally valid JSON-LD with `"mock": true`.
///
/// Useful for local dev where GXDCH cannot resolve `did:web:*.keasy.local`.
use serde_json::{Value, json};

use crate::gaia_x::cert;

/// Mock GXDCH client — no network calls.
#[derive(Clone)]
pub struct MockGxdch;

impl MockGxdch {
    /// Return a mock LRN Verifiable Credential.
    pub fn request_lrn_credential(
        &self,
        domain: &str,
        lrn_type: &str,
        lrn_value: &str,
    ) -> Result<Value, String> {
        tracing::warn!("[MOCK] Returning mock LRN credential for {domain}");
        let vc_id = format!("https://{}/.well-known/lrn.json", domain);
        let lrn_key = format!("gx:{lrn_type}");

        Ok(json!({
            "@context": [
                "https://www.w3.org/2018/credentials/v1",
                "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/participant"
            ],
            "type": ["VerifiableCredential"],
            "id": &vc_id,
            "issuer": "did:web:registration.lab.gaia-x.eu:development",
            "issuanceDate": jiff::Timestamp::now().to_string(),
            "credentialSubject": {
                "type": "gx:legalRegistrationNumber",
                "id": &vc_id,
                lrn_key: lrn_value
            },
            "mock": true
        }))
    }

    /// Return a mock Compliance Verifiable Credential.
    pub fn submit_compliance(&self, _vp: &Value, domain: &str) -> Result<Value, String> {
        tracing::warn!("[MOCK] Returning mock Compliance VC for {domain}");
        let vc_id = format!("https://{}/.well-known/compliance.json", domain);

        Ok(json!({
            "@context": [
                "https://www.w3.org/2018/credentials/v1",
                "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/participant"
            ],
            "type": ["VerifiableCredential"],
            "id": &vc_id,
            "issuer": "did:web:compliance.lab.gaia-x.eu:development",
            "issuanceDate": jiff::Timestamp::now().to_string(),
            "credentialSubject": [{
                "type": "gx:compliance",
                "id": format!("did:web:{domain}"),
                "gx:integrity": "sha256-mock",
                "gx:version": "22.10"
            }],
            "mock": true
        }))
    }

    /// Generate a self-signed certificate for dev/testing.
    pub fn generate_self_signed_cert(domain: &str) -> Result<String, String> {
        cert::generate_self_signed(domain)
    }
}
