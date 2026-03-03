/// JSON-LD credential assembly for Gaia-X compliance (VC-06).
///
/// Three functions that assemble credential JSON WITHOUT the `proof` field.
/// The `proof` is added separately by `signing::sign_credential`.
///
/// CRITICAL (VC-06): All credential linking uses `credentialSubject.id` (with the
/// `#cs` suffix URL pattern), NOT the top-level `id` field. The LP credential's
/// `gx:legalRegistrationNumber.id` must point to the LRN's `credentialSubject.id` value.
use jiff::Timestamp;
use serde_json::{Value, json};

/// Standard Gaia-X Trust Framework context URL (Loire / v1-staging release).
const TRUSTFRAMEWORK_CTX: &str = "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/trustframework#";

/// T&C text from the Gaia-X registry.
/// TODO: fetch dynamically from https://registry.lab.gaia-x.eu/development/api/termsAndConditions
/// at runtime rather than embedding. Embedded here as a fallback.
const TERMS_AND_CONDITIONS_TEXT: &str =
    "The PARTICIPANT signing the self-description agrees as follows: \
     - to update its self-description about any changes, be it technical, \
     organizational, or legal - especially but not limited to contractual in particular \
     but not limited to service level agreements, fees, communication in the function of \
     a Gaia-X member: \
      \n a) to be invited to events; \
      \n b) to receive updates of the Gaia-X Association; \
      \n c) to be displayed on the Gaia-X website and other channels; \
     The PARTICIPANT agrees as follows \
      \n - to respond to requests for clarification sent by Gaia-X within a reasonable \
     time period, \
      \n - to maintain accurate and up-to-date information until they decide to cancel \
     their participation.";

/// Returns the current UTC timestamp in ISO 8601 format (e.g. "2025-01-15T12:00:00Z").
fn iso_now() -> String {
    Timestamp::now().to_string()
}

/// Assemble the LRN (Legal Registration Number) request body for the GXDCH Notary.
///
/// This is NOT a full Verifiable Credential — it is the request body sent to the
/// Notary endpoint. The Notary returns a signed VC in response.
///
/// - `domain`: the org's public domain (e.g. "example.com")
/// - `lrn_type`: one of "vatID", "leiCode", "EORI"
/// - `lrn_value`: the registration number value (e.g. "DE123456789")
pub fn assemble_lrn_request(domain: &str, lrn_type: &str, lrn_value: &str) -> Value {
    let lrn_key = format!("gx:{lrn_type}");
    json!({
        "@context": [
            "https://registry.lab.gaia-x.eu/development/api/trusted-shape-registry/v1/shapes/jsonld/participant"
        ],
        "type": "gx:legalRegistrationNumber",
        "id": format!("https://{}/.well-known/lrn.json", domain),
        lrn_key: lrn_value
    })
}

/// Assemble a LegalParticipant Verifiable Credential (without proof).
///
/// VC-06: credentialSubject.id uses the `#cs` suffix pattern.
/// The `gx:legalRegistrationNumber.id` links to the LRN credentialSubject.id.
///
/// - `domain`: the org's public domain
/// - `legal_name`: organization's legal name
/// - `country_code`: ISO 3166-2 subdivision code (e.g. "DE-BY")
pub fn assemble_legal_participant(domain: &str, legal_name: &str, country_code: &str) -> Value {
    let did = format!("did:web:{domain}");
    let vc_id = format!("https://{}/.well-known/participant.json", domain);
    // VC-06: credentialSubject.id uses #cs suffix
    let cs_id = format!("{}#cs", vc_id);
    // Links to the LRN credential's credentialSubject.id (VC-06)
    let lrn_cs_id = format!("https://{}/.well-known/lrn.json#cs", domain);

    json!({
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://w3id.org/security/suites/jws-2020/v1",
            TRUSTFRAMEWORK_CTX
        ],
        "type": ["VerifiableCredential"],
        "id": vc_id,
        "issuer": did,
        "issuanceDate": iso_now(),
        "credentialSubject": {
            // VC-06: use credentialSubject.id (NOT top-level id) for linking
            "id": cs_id,
            "type": "gx:LegalParticipant",
            "gx:legalName": legal_name,
            // Links to LRN credentialSubject.id per VC-06
            "gx:legalRegistrationNumber": {
                "id": lrn_cs_id
            },
            "gx:headquarterAddress": {
                "gx:countrySubdivisionCode": country_code
            },
            "gx:legalAddress": {
                "gx:countrySubdivisionCode": country_code
            }
        }
    })
}

/// Assemble a GaiaXTermsAndConditions Verifiable Credential (without proof).
///
/// VC-06: credentialSubject.id uses the `#cs` suffix pattern.
///
/// - `domain`: the org's public domain
pub fn assemble_terms_conditions(domain: &str) -> Value {
    let did = format!("did:web:{domain}");
    let vc_id = format!("https://{}/.well-known/tandc.json", domain);
    // VC-06: credentialSubject.id uses #cs suffix
    let cs_id = format!("{}#cs", vc_id);

    json!({
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://w3id.org/security/suites/jws-2020/v1",
            TRUSTFRAMEWORK_CTX
        ],
        "type": ["VerifiableCredential"],
        "id": vc_id,
        "issuer": did,
        "issuanceDate": iso_now(),
        "credentialSubject": {
            // VC-06: use credentialSubject.id for linking
            "id": cs_id,
            "type": "gx:GaiaXTermsAndConditions",
            "gx:termsAndConditions": TERMS_AND_CONDITIONS_TEXT
        }
    })
}
