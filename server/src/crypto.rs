use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use secrecy::zeroize::Zeroizing;

const NONCE_LEN: usize = 12;
const VERSION: u8 = 0x02;

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

pub fn encrypt(plaintext: &[u8], key: &SecretKey) -> Result<Vec<u8>, String> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce_bytes).map_err(|e| format!("rng failed: {e}"))?;

    let ciphertext = key
        .cipher()
        .encrypt(&Nonce::from(nonce_bytes), plaintext)
        .map_err(|e| format!("encryption failed: {e}"))?;

    let mut out = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    out.push(VERSION);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt(data: &[u8], key: &SecretKey) -> Result<Vec<u8>, String> {
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
        .decrypt(&Nonce::from(nonce_bytes), &data[header..])
        .map_err(|_| "decryption failed (wrong key or corrupted data)".into())
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
        let sealed = encrypt(b"s3cr3t", &k).unwrap();
        assert_ne!(&sealed[1 + NONCE_LEN..], b"s3cr3t");
        assert_eq!(decrypt(&sealed, &k).unwrap(), b"s3cr3t");
    }

    #[test]
    fn the_wrong_key_opens_nothing() {
        let sealed = encrypt(b"s3cr3t", &key(7)).unwrap();
        assert!(decrypt(&sealed, &key(8)).is_err());
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
