/// X.509 certificate chain validation (VC-05).
///
/// Validates:
/// - At least one certificate is present in the PEM
/// - No certificate is expired
///
/// Note: the root CA self-signed check has been relaxed. TLS chains from ACME
/// (Let's Encrypt) typically don't include the root CA. GXDCH validates independently.
// Use the explicit crate path to avoid ambiguity with the `pem` module
// re-exported by `x509_parser::prelude::*`.
use ::pem::parse_many;
use std::path::Path;
use x509_parser::prelude::*;

/// Error type returned when certificate chain validation fails.
#[derive(Debug)]
pub struct CertValidationError(pub String);

impl std::fmt::Display for CertValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Validate an X.509 certificate chain supplied as PEM text.
///
/// The PEM may contain one or more certificates delimited by
/// `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----` blocks.
///
/// Validation rules (VC-05):
/// 1. At least one certificate must be present.
/// 2. No certificate may be expired.
pub fn validate_chain(chain_pem: &str) -> Result<(), CertValidationError> {
    // Parse all CERTIFICATE PEM blocks.
    let pem_items = parse_many(chain_pem.as_bytes())
        .map_err(|e| CertValidationError(format!("failed to parse PEM: {e}")))?;

    // Collect DER bytes for CERTIFICATE labels only.
    let der_blobs: Vec<Vec<u8>> = pem_items
        .into_iter()
        .filter(|p| p.tag() == "CERTIFICATE")
        .map(|p| p.into_contents())
        .collect();

    if der_blobs.is_empty() {
        return Err(CertValidationError(
            "No certificates found in PEM".to_string(),
        ));
    }

    // Parse each DER blob with x509_parser.
    // We need to keep the DER bytes alive while we use the parsed structs.
    // Parse into a struct that owns the DER bytes and the parsed cert side-by-side.
    struct OwnedCert {
        _der: Vec<u8>,
        // SAFETY: the cert borrows from _der which is heap-allocated and does not move.
        cert: X509Certificate<'static>,
    }

    let mut owned_certs: Vec<OwnedCert> = Vec::with_capacity(der_blobs.len());
    for der in der_blobs {
        let (_, cert) = X509Certificate::from_der(&der)
            .map_err(|e| CertValidationError(format!("failed to parse DER certificate: {e}")))?;
        // SAFETY: we extend the lifetime to 'static so we can store it alongside the DER.
        // The DER bytes are heap-allocated and will not move for the duration of this function.
        let cert_static: X509Certificate<'static> = unsafe { std::mem::transmute(cert) };
        owned_certs.push(OwnedCert {
            _der: der,
            cert: cert_static,
        });
    }

    // Validate expiry: no cert may have not_after < now.
    let now = ASN1Time::now();
    for owned in &owned_certs {
        let validity = owned.cert.validity();
        if validity.not_after < now {
            return Err(CertValidationError(format!(
                "Certificate expired: {}",
                owned.cert.subject()
            )));
        }
    }

    Ok(())
}

/// Try to read a TLS certificate chain from Caddy's data directory.
///
/// Tries paths in order:
/// 1. Wildcard cert: `{dir}/caddy/certificates/acme-v02.api.letsencrypt.org-directory/wildcard_.{domain}/wildcard_.{domain}.crt`
/// 2. Exact cert: `{dir}/caddy/certificates/acme-v02.api.letsencrypt.org-directory/{domain}/{domain}.crt`
pub fn read_caddy_cert_chain(caddy_dir: &Path, base_domain: &str) -> Result<String, String> {
    let acme_dir = caddy_dir
        .join("caddy")
        .join("certificates")
        .join("acme-v02.api.letsencrypt.org-directory");

    let candidates = [
        acme_dir
            .join(format!("wildcard_.{base_domain}"))
            .join(format!("wildcard_.{base_domain}.crt")),
        acme_dir
            .join(base_domain)
            .join(format!("{base_domain}.crt")),
    ];

    for path in &candidates {
        if path.exists() {
            return std::fs::read_to_string(path)
                .map_err(|e| format!("failed to read cert at {}: {e}", path.display()));
        }
    }

    Err(format!(
        "No Caddy TLS certificate found for {base_domain} in {}",
        caddy_dir.display()
    ))
}

/// Generate a self-signed certificate for dev/testing.
///
/// Uses rcgen to create a self-signed cert for the given domain.
/// Called by `MockGxdch` when no Caddy certs or explicit PEM are available.
pub fn generate_self_signed(domain: &str) -> Result<String, String> {
    let certified_key = rcgen::generate_simple_self_signed(vec![domain.to_string()])
        .map_err(|e| format!("rcgen self-signed generation failed: {e}"))?;
    Ok(certified_key.cert.pem())
}
