use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use secrecy::zeroize::Zeroizing;
use sha2::Sha256;

const PBKDF2_ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const VERSION: u8 = 0x01;

pub fn encrypt(plaintext: &[u8], secret: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::getrandom(&mut salt).map_err(|e| format!("rng failed: {e}"))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce_bytes).map_err(|e| format!("rng failed: {e}"))?;

    let key = derive_key(secret, &salt);
    let cipher = Aes256Gcm::new((&*key).into());
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encryption failed: {e}"))?;

    let mut out = Vec::with_capacity(1 + SALT_LEN + NONCE_LEN + ciphertext.len());
    out.push(VERSION);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt(data: &[u8], secret: &str) -> Result<Vec<u8>, String> {
    let header = 1 + SALT_LEN + NONCE_LEN;
    if data.len() < header {
        return Err("data too short".into());
    }
    if data[0] != VERSION {
        return Err(format!("unsupported version: {}", data[0]));
    }

    let salt = &data[1..1 + SALT_LEN];
    let nonce_bytes = &data[1 + SALT_LEN..header];
    let ciphertext = &data[header..];

    let key = derive_key(secret, salt);
    let cipher = Aes256Gcm::new((&*key).into());
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decryption failed (wrong key or corrupted data)".into())
}

fn derive_key(secret: &str, salt: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0u8; 32]);
    pbkdf2::pbkdf2_hmac::<Sha256>(secret.as_bytes(), salt, PBKDF2_ITERATIONS, &mut *key);
    key
}
