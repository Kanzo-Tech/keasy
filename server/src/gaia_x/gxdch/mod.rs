/// GXDCH (Gaia-X Digital Clearing House) client — strategy pattern.
///
/// `GxdchClient::Real` calls the live GXDCH staging/production APIs.
/// `GxdchClient::Mock` returns structurally valid JSON-LD with `"mock": true`,
/// useful for local dev where GXDCH cannot resolve `did:web:*.keasy.local`.
pub mod mock;
pub mod real;

use serde_json::Value;
use std::fmt;

pub use mock::MockGxdch;
pub use real::RealGxdch;

/// Default GXDCH Notary URL (v1-staging).
pub const GXDCH_NOTARY_URL: &str =
    "https://registrationnumber.notary.lab.gaia-x.eu/v1-staging/registrationNumberVC";

/// Default GXDCH Compliance Service URL (v1-staging).
pub const GXDCH_COMPLIANCE_URL: &str =
    "https://compliance.lab.gaia-x.eu/v1-staging/api/credential-offers";

/// Strategy enum — dispatches to real HTTP calls or local mock generators.
#[derive(Clone)]
pub enum GxdchClient {
    Real(RealGxdch),
    Mock(MockGxdch),
}

impl GxdchClient {
    /// Construct from config: Mock when `gxdch_mock` is true, Real otherwise.
    pub fn from_config(
        gxdch_mock: bool,
        notary_url: String,
        compliance_url: String,
    ) -> Self {
        if gxdch_mock {
            Self::Mock(MockGxdch)
        } else {
            Self::Real(RealGxdch { notary_url, compliance_url })
        }
    }

    /// Request a signed LRN Verifiable Credential from the GXDCH Notary.
    pub async fn request_lrn_credential(
        &self,
        domain: &str,
        lrn_type: &str,
        lrn_value: &str,
    ) -> Result<Value, String> {
        match self {
            Self::Real(r) => r.request_lrn_credential(domain, lrn_type, lrn_value).await,
            Self::Mock(m) => m.request_lrn_credential(domain, lrn_type, lrn_value),
        }
    }

    /// Submit a Verifiable Presentation to the GXDCH Compliance Service.
    pub async fn submit_compliance(&self, vp: &Value, domain: &str) -> Result<Value, String> {
        match self {
            Self::Real(r) => r.submit_compliance(vp).await,
            Self::Mock(m) => m.submit_compliance(vp, domain),
        }
    }

    /// Whether this client returns mock data (affects cert fallback logic).
    pub fn is_mock(&self) -> bool {
        matches!(self, Self::Mock(_))
    }
}

impl fmt::Display for GxdchClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Real(r) => write!(f, "Real(notary={}, compliance={})", r.notary_url, r.compliance_url),
            Self::Mock(_) => write!(f, "Mock"),
        }
    }
}
