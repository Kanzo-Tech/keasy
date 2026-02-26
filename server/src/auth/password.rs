use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use crate::auth::errors::AuthError;

/// Hash a password using Argon2id. Runs on spawn_blocking to avoid blocking the async executor.
#[allow(dead_code)]
pub async fn hash_password(password: String) -> Result<String, AuthError> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|_| AuthError::Internal("password hashing failed".to_string()))
    })
    .await
    .map_err(|e| AuthError::Internal(format!("spawn_blocking join: {e}")))?
}

/// Verify a candidate password against a stored Argon2id hash.
/// ALWAYS call this even when user not found (use dummy_hash) to prevent timing attacks.
#[allow(dead_code)]
pub async fn verify_password(candidate: String, stored_hash: String) -> bool {
    tokio::task::spawn_blocking(move || {
        let Ok(parsed) = PasswordHash::new(&stored_hash) else {
            return false;
        };
        Argon2::default()
            .verify_password(candidate.as_bytes(), &parsed)
            .is_ok()
    })
    .await
    .unwrap_or(false)
}

/// A pre-computed dummy hash with valid Argon2id parameters.
/// Used when user is not found to prevent timing-based user enumeration.
/// Generated once at module level. The actual password doesn't matter.
#[allow(dead_code)]
pub fn dummy_hash() -> &'static str {
    // This is a valid Argon2id hash of "dummy_password_for_timing_attack_prevention"
    // It will always fail verification against any real password, but takes the same time.
    // We generate this lazily at first call.
    static DUMMY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DUMMY.get_or_init(|| {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(b"dummy_password_for_timing_attack_prevention", &salt)
            .expect("dummy hash generation")
            .to_string()
    })
}

/// Validate password complexity per CONTEXT.md rules:
/// - Minimum 12 characters
/// - Maximum 128 characters
/// - At least one uppercase letter
/// - At least one lowercase letter
/// - At least one digit
///
/// Returns Ok(()) if valid, Err with reason if not.
#[allow(dead_code)]
pub fn validate_password(password: &str) -> Result<(), &'static str> {
    if password.len() < 12 {
        return Err("too short");
    }
    if password.len() > 128 {
        return Err("too long");
    }
    if !password.chars().any(|c| c.is_uppercase()) {
        return Err("missing uppercase letter");
    }
    if !password.chars().any(|c| c.is_lowercase()) {
        return Err("missing lowercase letter");
    }
    if !password.chars().any(|c| c.is_ascii_digit()) {
        return Err("missing digit");
    }
    Ok(())
}

/// Validate email format: must contain @ with non-empty local and domain parts.
/// This is intentionally simple per CONTEXT.md — no email verification.
#[allow(dead_code)]
pub fn validate_email(email: &str) -> bool {
    let parts: Vec<&str> = email.splitn(2, '@').collect();
    if parts.len() != 2 {
        return false;
    }
    let local = parts[0];
    let domain = parts[1];
    !local.is_empty() && !domain.is_empty() && domain.contains('.')
}
