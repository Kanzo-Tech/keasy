use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use secrecy::ExposeSecret;
use secrecy::zeroize::Zeroizing;
use serde_json::json;

use crate::domain::StorageCredentialInput;

const NONCE_LEN: usize = 12;
const VERSION: u8 = 0x03;

/// The AEAD key sealing stored secrets: `KEASY_SECRET_KEY`, 32 random bytes in
/// base64 (`openssl rand -base64 32`). It is already a key, so it is used as one.
#[derive(Clone)]
pub struct SecretKey(Zeroizing<[u8; 32]>);

impl SecretKey {
    pub fn from_base64(encoded: &str) -> Result<Self, String> {
        let bytes = Zeroizing::new(
            base64::engine::general_purpose::STANDARD
                .decode(encoded.trim())
                .map_err(|e| format!("not base64: {e}"))?,
        );
        let key: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| format!("decodes to {} bytes, not 32", bytes.len()))?;
        Ok(Self(Zeroizing::new(key)))
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new((&*self.0).into())
    }

    #[cfg(test)]
    pub(crate) fn for_tests() -> Self {
        Self(Zeroizing::new([42; 32]))
    }
}

/// Seal `plaintext` bound to `aad`: it opens only under the same key AND the
/// same `aad`, so a ciphertext copied into another row does not open.
pub fn seal(plaintext: &[u8], aad: &str, key: &SecretKey) -> Result<Vec<u8>, String> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce_bytes).map_err(|e| format!("rng failed: {e}"))?;

    let ciphertext = key
        .cipher()
        .encrypt(
            &Nonce::from(nonce_bytes),
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|e| format!("encryption failed: {e}"))?;

    let mut out = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    out.push(VERSION);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn open(data: &[u8], aad: &str, key: &SecretKey) -> Result<Vec<u8>, String> {
    let header = 1 + NONCE_LEN;
    if data.len() < header {
        return Err("data too short".into());
    }
    if data[0] != VERSION {
        return Err(format!("unsupported version: {}", data[0]));
    }

    let nonce_bytes: [u8; NONCE_LEN] = data[1..header]
        .try_into()
        .map_err(|_| "nonce of the wrong length".to_string())?;

    key.cipher()
        .decrypt(
            &Nonce::from(nonce_bytes),
            Payload {
                msg: &data[header..],
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| "decryption failed (wrong key, wrong row or corrupted data)".into())
}

/// What a credential row's ciphertext is bound to: a spec sealed for one name
/// opens under no other.
fn aad(name: &str) -> String {
    format!("credential:{name}")
}

/// The spec as it is sealed: the one place a secret is exposed as JSON, and the
/// JSON goes straight into the cipher.
fn plaintext(spec: &StorageCredentialInput) -> Vec<u8> {
    let value = match spec {
        StorageCredentialInput::S3 {
            access_key_id,
            secret_access_key,
            region,
            endpoint,
            role_arn,
            external_id,
        } => json!({
            "kind": "s3",
            "access_key_id": access_key_id,
            "secret_access_key": secret_access_key.expose_secret(),
            "region": region,
            "endpoint": endpoint,
            "role_arn": role_arn,
            "external_id": external_id,
        }),
        StorageCredentialInput::AzureAccountKey { account, key } => json!({
            "kind": "azure_account_key",
            "account": account,
            "key": key.expose_secret(),
        }),
        StorageCredentialInput::AzureServicePrincipal {
            account,
            tenant_id,
            client_id,
            client_secret,
        } => json!({
            "kind": "azure_service_principal",
            "account": account,
            "tenant_id": tenant_id,
            "client_id": client_id,
            "client_secret": client_secret.expose_secret(),
        }),
    };
    value.to_string().into_bytes()
}

/// Seal the credential `name` holds.
pub fn seal_spec(
    name: &str,
    spec: &StorageCredentialInput,
    key: &SecretKey,
) -> Result<Vec<u8>, String> {
    seal(&Zeroizing::new(plaintext(spec)), &aad(name), key)
}

/// Open the credential `name` holds.
pub fn open_spec(
    name: &str,
    sealed: &[u8],
    key: &SecretKey,
) -> Result<StorageCredentialInput, String> {
    let plain = Zeroizing::new(open(sealed, &aad(name), key)?);
    serde_json::from_slice(&plain).map_err(|e| format!("the sealed spec does not parse: {e}"))
}

/// The same credential, sealed under `new` instead of `old`.
pub fn reseal(
    name: &str,
    sealed: &[u8],
    old: &SecretKey,
    new: &SecretKey,
) -> Result<Vec<u8>, String> {
    let plain = Zeroizing::new(open(sealed, &aad(name), old)?);
    seal(&plain, &aad(name), new)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> SecretKey {
        SecretKey::from_base64(&base64::engine::general_purpose::STANDARD.encode([byte; 32]))
            .unwrap()
    }

    #[test]
    fn a_secret_round_trips() {
        let k = key(7);
        let sealed = seal(b"s3cr3t", "credential:a", &k).unwrap();
        assert_ne!(&sealed[1 + NONCE_LEN..], b"s3cr3t");
        assert_eq!(open(&sealed, "credential:a", &k).unwrap(), b"s3cr3t");
    }

    #[test]
    fn the_wrong_key_opens_nothing() {
        let sealed = seal(b"s3cr3t", "credential:a", &key(7)).unwrap();
        assert!(open(&sealed, "credential:a", &key(8)).is_err());
    }

    #[test]
    fn a_ciphertext_moved_to_another_row_opens_nothing() {
        let k = key(7);
        let sealed = seal(b"s3cr3t", "credential:a", &k).unwrap();
        assert!(open(&sealed, "credential:b", &k).is_err());
    }

    #[test]
    fn a_key_is_exactly_32_bytes_of_base64() {
        let b64 = |n: usize| base64::engine::general_purpose::STANDARD.encode(vec![1u8; n]);
        assert!(SecretKey::from_base64(&b64(32)).is_ok());
        assert!(SecretKey::from_base64(&b64(16)).is_err());
        assert!(SecretKey::from_base64(&b64(33)).is_err());
        assert!(SecretKey::from_base64("a passphrase, not a key").is_err());
    }
}
