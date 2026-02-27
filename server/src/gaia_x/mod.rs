/// Gaia-X compliance wizard — module root.
///
/// This module implements the full Gaia-X credential lifecycle:
/// - P-256 key pair generation
/// - X.509 certificate chain validation (VC-05)
/// - JSON-LD credential assembly with credentialSubject.id linking (VC-06)
/// - JsonWebSignature2020 proof generation
/// - Verifiable Presentation assembly with inline credentials (VC-07)
/// - GXDCH Notary and Compliance Service HTTP clients
/// - Wizard state persistence per org
/// - Axum route handlers for all wizard endpoints
pub mod cert;
pub mod credentials;
pub mod db;
pub mod gxdch;
pub mod keys;
pub mod routes;
pub mod signing;
pub mod vp;

use serde::{Deserialize, Serialize};

/// Wizard state record — mirrors the gaia_x_wizard_state table.
/// All credential/key/cert fields are stored as JSON or PEM text.
/// Private key is NEVER stored — only public_key_jwk (locked decision).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WizardState {
    pub org_id: String,
    pub current_step: i64,
    pub public_key_jwk: Option<String>,
    pub cert_chain_pem: Option<String>,
    pub root_ca_pem: Option<String>,
    pub did_document: Option<String>,
    pub lrn_credential: Option<String>,
    pub lp_credential: Option<String>,
    pub tc_credential: Option<String>,
    pub compliance_vc: Option<String>,
    pub lrn_type: Option<String>,
    pub lrn_value: Option<String>,
    pub legal_name: Option<String>,
    pub country_code: Option<String>,
    pub domain: Option<String>,
    pub updated_at: String,
}
