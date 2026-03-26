/// Verifiable Presentation assembly (VC-07).
///
/// Assembles a VP with all three credentials (LRN, LegalParticipant, T&C) included
/// INLINE as full signed credential objects — NOT URL references (VC-07 locked decision).
/// GXDCH Compliance Service will reject URL references in verifiableCredential.
use serde_json::{Value, json};

/// Assemble a Verifiable Presentation wrapping all three Gaia-X credentials.
///
/// VC-07: All credentials are included as full inline objects.
/// The VP does not carry its own proof — only the individual credentials are signed.
///
/// - `lrn`: signed LRN Verifiable Credential from GXDCH Notary
/// - `lp`: self-signed LegalParticipant Verifiable Credential
/// - `tc`: self-signed T&C Verifiable Credential
pub fn assemble_vp(lrn: &Value, lp: &Value, tc: &Value) -> Value {
    json!({
        "@context": "https://www.w3.org/2018/credentials/v1",
        "type": "VerifiablePresentation",
        // VC-07: full inline credential objects, no URL references
        "verifiableCredential": [
            lrn,
            lp,
            tc
        ]
    })
}
