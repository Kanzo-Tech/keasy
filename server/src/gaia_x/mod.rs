/// Gaia-X compliance — module root.
///
/// This module implements the full Gaia-X credential lifecycle:
/// - P-256 key pair generation
/// - X.509 certificate chain validation (VC-05)
/// - JSON-LD credential assembly with credentialSubject.id linking (VC-06)
/// - JsonWebSignature2020 proof generation
/// - Verifiable Presentation assembly with inline credentials (VC-07)
/// - GXDCH Notary and Compliance Service HTTP clients
/// - State persistence per org
/// - Axum route handlers for compliance endpoints
pub mod cert;
pub mod credentials;
pub mod db;
pub mod gxdch;
pub mod keys;
pub mod routes;
pub mod signing;
pub mod vp;

use serde::{Deserialize, Serialize};

/// Gaia-X state record — mirrors the org_gaiax table.
/// All credential/key/cert fields are stored as JSON or PEM text.
/// Private key is NEVER stored — only public_key_jwk (locked decision).
/// did_document is NOT stored — derived at runtime from public_key_jwk + domain.
/// legal_name and country_code come from organizations, not from this state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GaiaxState {
    pub org_id: String,
    pub public_key_jwk: Option<String>,
    pub cert_chain_pem: Option<String>,
    pub lrn_credential: Option<String>,
    pub lp_credential: Option<String>,
    pub tc_credential: Option<String>,
    pub compliance_vc: Option<String>,
    pub lrn_type: Option<String>,
    pub lrn_value: Option<String>,
    pub domain: Option<String>,
    pub updated_at: String,
}

/// Request body for the one-click comply endpoint.
#[derive(Deserialize, utoipa::ToSchema)]
pub struct ComplyRequest {
    /// Optional PEM cert chain — fallback if Caddy certs are unavailable.
    pub cert_chain_pem: Option<String>,
}

/// Response from the one-click comply endpoint.
#[derive(Serialize, utoipa::ToSchema)]
pub struct ComplyResponse {
    pub compliant: bool,
    /// PEM-encoded private key (auto-download on success).
    pub private_key_pem: Option<String>,
    /// The compliance Verifiable Credential.
    #[schema(schema_with = json_object)]
    pub compliance_vc: Option<serde_json::Value>,
    /// Error message on failure.
    pub error: Option<String>,
    /// Which phase failed: key_generation, certificate, lrn_request, lp_signing, tc_signing, compliance_submission.
    pub failed_phase: Option<String>,
}

/// SSE event emitted during the comply pipeline.
#[derive(Serialize, utoipa::ToSchema)]
pub struct ComplyEvent {
    /// Phase name: key_generation, certificate, lrn_request, signing, compliance_submission, complete
    pub phase: String,
    /// Index 0-5, maps to frontend PHASES array
    pub index: u8,
    /// Error message (only on failure)
    pub error: Option<String>,
    /// Final result (only on "complete" or error-after-key-gen)
    pub data: Option<ComplyResponse>,
}

/// Construct a `did:web:{domain}` DID.
pub fn did_web(domain: &str) -> String {
    format!("did:web:{domain}")
}

/// Construct a `did:web:{domain}#key-1` verification method ID.
pub fn did_web_key(domain: &str) -> String {
    format!("did:web:{domain}#key-1")
}

/// Construct a `https://{domain}/.well-known/{name}` URL.
pub fn well_known_url(domain: &str, name: &str) -> String {
    format!("https://{domain}/.well-known/{name}")
}

fn json_object() -> utoipa::openapi::schema::Object {
    use utoipa::openapi::schema::{AdditionalProperties, ObjectBuilder};
    ObjectBuilder::new()
        .additional_properties(Some(AdditionalProperties::FreeForm(true)))
        .build()
}
