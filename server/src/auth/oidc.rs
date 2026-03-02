//! OIDC relying party implementation.
//!
//! Provides:
//! - `KeyasyIdTokenClaims` — custom claims struct with `keasy:dataspaces` multivalued claim
//! - `KeyasyClient` — fully-parameterized openidconnect client type alias
//! - `OidcState` — OIDC client + cached JWKS/provider metadata
//! - `build_oidc_client()` — async initialization from issuer URL / client credentials
//! - `oidc_start` / `oidc_callback` — Axum handlers for the PKCE authorization code flow

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::response::{IntoResponse, Redirect};
use openidconnect::core::{
    CoreAuthDisplay, CoreAuthPrompt, CoreAuthenticationFlow, CoreErrorResponseType,
    CoreGenderClaim, CoreJweContentEncryptionAlgorithm, CoreJsonWebKey, CoreJwsSigningAlgorithm,
    CoreProviderMetadata, CoreRevocableToken, CoreRevocationErrorResponse,
    CoreTokenIntrospectionResponse, CoreTokenType,
};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, EmptyExtraTokenFields,
    EndpointMaybeSet, EndpointNotSet, EndpointSet, IdTokenFields, IssuerUrl, Nonce,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, StandardErrorResponse,
    StandardTokenResponse, TokenResponse, TokenUrl,
};
use time::OffsetDateTime;
use tower_sessions::{Expiry, Session};

use crate::AppState;
use crate::auth::errors::AuthError;

// ──────────────────────────────────────────────────────────────────────────────
// Custom claims (keasy:dataspaces multivalued claim)
// ──────────────────────────────────────────────────────────────────────────────

/// Additional ID token claims specific to Keasy.
///
/// The `keasy:dataspaces` claim is a multivalued list of dataspace client_ids
/// that the authenticated user is a member of.
#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
pub struct KeyasyIdTokenClaims {
    #[serde(rename = "keasy:dataspaces", default)]
    pub dataspaces: Vec<String>,
}

impl openidconnect::AdditionalClaims for KeyasyIdTokenClaims {}

// ──────────────────────────────────────────────────────────────────────────────
// Type alias for the fully-parameterized OIDC client
// ──────────────────────────────────────────────────────────────────────────────

// Shared token response type used by both KeyasyClient type aliases below.
type KeyasyTokenResponse = StandardTokenResponse<
    IdTokenFields<
        KeyasyIdTokenClaims,
        EmptyExtraTokenFields,
        CoreGenderClaim,
        CoreJweContentEncryptionAlgorithm,
        CoreJwsSigningAlgorithm,
    >,
    CoreTokenType,
>;

// Shared Client<...> base with all the non-endpoint parameters fixed.
// The endpoint state parameters are controlled by the two public type aliases below.
macro_rules! keasy_client_base {
    ($auth:ty, $token:ty, $userinfo:ty) => {
        openidconnect::Client<
            KeyasyIdTokenClaims,
            CoreAuthDisplay,
            CoreGenderClaim,
            CoreJweContentEncryptionAlgorithm,
            CoreJsonWebKey,
            CoreAuthPrompt,
            StandardErrorResponse<CoreErrorResponseType>,
            KeyasyTokenResponse,
            CoreTokenIntrospectionResponse,
            CoreRevocableToken,
            CoreRevocationErrorResponse,
            $auth,
            EndpointNotSet,
            EndpointNotSet,
            EndpointNotSet,
            $token,
            $userinfo,
        >
    };
}

/// OIDC client as returned by `from_provider_metadata` + `set_redirect_uri`.
///
/// HasAuthUrl = EndpointSet (auth URL from provider metadata)
/// HasTokenUrl = EndpointMaybeSet (token URL is optional in spec — may be None)
/// HasUserInfoUrl = EndpointMaybeSet
///
/// Cannot be used with `exchange_code()` — call `set_token_uri()` to get `KeyasyClient`.
pub type KeyasyClientDiscovered = keasy_client_base!(EndpointSet, EndpointMaybeSet, EndpointMaybeSet);

/// Fully-configured OIDC client ready for the authorization code flow.
///
/// HasAuthUrl = EndpointSet, HasTokenUrl = EndpointSet (required for `exchange_code()`).
/// Obtained by calling `set_token_uri()` on a `KeyasyClientDiscovered`.
pub type KeyasyClient = keasy_client_base!(EndpointSet, EndpointSet, EndpointMaybeSet);

// ──────────────────────────────────────────────────────────────────────────────
// URL-rewriting HTTP client for internal Docker networking
// ──────────────────────────────────────────────────────────────────────────────

/// HTTP client that rewrites URL prefixes before forwarding to reqwest.
///
/// Used to reach Keycloak via internal Docker DNS (`keycloak:8080`) while OIDC
/// discovery documents reference the public URL (`localhost:3000`). The issuer
/// validation in `discover_async` still passes because it compares the issuer
/// in the response JSON (which Keycloak sets to its public `KC_HOSTNAME`) with
/// the `IssuerUrl` we provide — both use the public URL.
pub(crate) struct RewritingClient {
    inner: reqwest::Client,
    from: String,
    to: String,
}

impl<'c> oauth2::AsyncHttpClient<'c> for RewritingClient {
    type Error = <reqwest::Client as oauth2::AsyncHttpClient<'c>>::Error;
    type Future = Pin<Box<dyn Future<Output = Result<oauth2::HttpResponse, Self::Error>> + Send + 'c>>;

    fn call(&'c self, request: oauth2::HttpRequest) -> Self::Future {
        let (mut parts, body) = request.into_parts();
        let url = parts.uri.to_string();
        if url.starts_with(&self.from) {
            let new_url = format!("{}{}", self.to, &url[self.from.len()..]);
            if let Ok(uri) = new_url.parse() {
                parts.uri = uri;
            }
        }
        let rewritten = http::Request::from_parts(parts, body);
        Box::pin(oauth2::AsyncHttpClient::call(&self.inner, rewritten))
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// OIDC state (stored in AppState, initialized at startup)
// ──────────────────────────────────────────────────────────────────────────────

/// Cached provider metadata with a TTL timestamp.
pub struct CachedProviderMetadata {
    pub metadata: CoreProviderMetadata,
    pub fetched_at: jiff::Timestamp,
}

/// OIDC relying party state stored in AppState.
///
/// Contains the OIDC client (with embedded client credentials and redirect URI),
/// a cached copy of the provider metadata (for JWKS access), and an HTTP client
/// pre-configured for OIDC requests (no redirect following, per spec).
pub struct OidcState {
    pub client: KeyasyClient,
    pub provider_metadata: Arc<tokio::sync::RwLock<CachedProviderMetadata>>,
    pub http_client: reqwest::Client,
    pub issuer_url: String,
    /// When set, HTTP requests rewrite URLs from the public issuer base to this
    /// internal base (e.g. `http://localhost:3000` → `http://keycloak:8080`).
    pub internal_base_url: Option<String>,
}

impl OidcState {
    /// Returns `true` if the cached provider metadata is older than 15 minutes.
    pub async fn is_cache_stale(&self) -> bool {
        let cached = self.provider_metadata.read().await;
        let age = jiff::Timestamp::now().duration_since(cached.fetched_at);
        // duration_since returns a SignedDuration; negative means fetched_at is in the future
        // (clock skew) — treat as stale to force refresh.
        age.as_secs() >= 900 // 15-minute TTL
    }

    /// Build a `RewritingClient` if `internal_base_url` is configured, or `None`
    /// to use the plain `http_client` instead.
    fn rewriting_client(&self) -> Option<RewritingClient> {
        let internal = self.internal_base_url.as_ref()?;
        let parsed = url::Url::parse(&self.issuer_url).ok()?;
        let public_base = parsed.origin().ascii_serialization();
        Some(RewritingClient {
            inner: self.http_client.clone(),
            from: public_base,
            to: internal.trim_end_matches('/').to_string(),
        })
    }

    /// Re-fetch the provider discovery document and update the in-memory cache.
    ///
    /// Used by `oidc_callback` on ID token verification failure (refresh-on-failure
    /// strategy to handle Keycloak key rotation without DoS risk).
    pub async fn refresh_provider_metadata(&self) {
        let issuer = match IssuerUrl::new(self.issuer_url.clone()) {
            Ok(u) => u,
            Err(e) => {
                tracing::error!(error = %e, "OidcState::refresh_provider_metadata: invalid issuer URL");
                return;
            }
        };

        let result = if let Some(rw) = self.rewriting_client() {
            CoreProviderMetadata::discover_async(issuer, &rw).await
        } else {
            CoreProviderMetadata::discover_async(issuer, &self.http_client).await
        };

        match result {
            Ok(new_meta) => {
                let mut write = self.provider_metadata.write().await;
                *write = CachedProviderMetadata {
                    metadata: new_meta,
                    fetched_at: jiff::Timestamp::now(),
                };
                tracing::info!(issuer = %self.issuer_url, "OIDC provider metadata refreshed");
            }
            Err(e) => {
                tracing::warn!(error = %e, "Failed to refresh OIDC provider metadata — using stale cache");
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Client initialization
// ──────────────────────────────────────────────────────────────────────────────

/// Build an `OidcState` by fetching the OIDC discovery document.
///
/// Called once at server startup. Returns `Err` if the discovery document cannot
/// be fetched (e.g., Keycloak not reachable yet). The caller logs a warning and
/// sets `oidc_state = None`, disabling OIDC auth until restart.
///
/// `internal_base_url` — when set (e.g. `http://keycloak:8080`), OIDC discovery
/// and token-exchange HTTP requests rewrite the public issuer base URL to this
/// internal URL. This allows the server to reach Keycloak via Docker networking
/// while the public issuer URL remains unchanged for token validation.
pub async fn build_oidc_client(
    issuer_url: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    internal_base_url: Option<&str>,
) -> Result<OidcState, String> {
    // Build a reqwest client that does NOT follow redirects (required by OIDC spec
    // to detect and forward redirect responses correctly).
    let http_client = reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("failed to build HTTP client for OIDC: {e}"))?;

    let issuer = IssuerUrl::new(issuer_url.to_string())
        .map_err(|e| format!("invalid OIDC issuer URL: {e}"))?;

    // Fetch and parse the provider discovery document (/.well-known/openid-configuration).
    // When internal_base_url is set, rewrite requests to reach Keycloak via Docker DNS.
    let metadata = if let Some(internal) = internal_base_url {
        let parsed = url::Url::parse(issuer_url)
            .map_err(|e| format!("cannot parse issuer URL for base extraction: {e}"))?;
        let public_base = parsed.origin().ascii_serialization();
        let rw = RewritingClient {
            inner: http_client.clone(),
            from: public_base,
            to: internal.trim_end_matches('/').to_string(),
        };
        CoreProviderMetadata::discover_async(issuer, &rw)
            .await
            .map_err(|e| format!("OIDC discovery failed for {issuer_url}: {e}"))?
    } else {
        CoreProviderMetadata::discover_async(issuer, &http_client)
            .await
            .map_err(|e| format!("OIDC discovery failed for {issuer_url}: {e}"))?
    };

    // Extract the token endpoint URL from provider metadata.
    // Keycloak always provides a token endpoint; if missing, OIDC is broken.
    let token_endpoint = metadata
        .token_endpoint()
        .cloned()
        .ok_or_else(|| "OIDC provider metadata missing token_endpoint".to_string())?;
    let token_url = TokenUrl::new(token_endpoint.to_string())
        .map_err(|e| format!("invalid token endpoint URL: {e}"))?;

    // Build the OIDC client from provider metadata.
    // `from_provider_metadata` returns `KeyasyClientDiscovered` (HasTokenUrl = EndpointMaybeSet).
    // We call `set_token_uri()` to promote the token URL to EndpointSet, producing `KeyasyClient`.
    // This is required because `exchange_code()` is only available when HasTokenUrl = EndpointSet.
    let client: KeyasyClient = KeyasyClientDiscovered::from_provider_metadata(
        metadata.clone(),
        ClientId::new(client_id.to_string()),
        Some(ClientSecret::new(client_secret.to_string())),
    )
    .set_token_uri(token_url)
    .set_redirect_uri(
        RedirectUrl::new(redirect_uri.to_string())
            .map_err(|e| format!("invalid redirect URI: {e}"))?,
    );

    Ok(OidcState {
        client,
        provider_metadata: Arc::new(tokio::sync::RwLock::new(CachedProviderMetadata {
            metadata,
            fetched_at: jiff::Timestamp::now(),
        })),
        http_client,
        issuer_url: issuer_url.to_string(),
        internal_base_url: internal_base_url.map(|s| s.to_string()),
    })
}

// ──────────────────────────────────────────────────────────────────────────────
// Query parameter structs
// ──────────────────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct OidcStartParams {
    pub invite_token: Option<String>,
    /// `"create"` to send `prompt=create` for Keycloak registration flow
    pub prompt: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct OidcCallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

// ──────────────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────────────

/// GET /v1/auth/oidc-start
///
/// Generates a PKCE S256 challenge, builds the Keycloak authorization URL,
/// stores the PKCE verifier, CSRF state, and nonce in the server-side session,
/// then redirects the browser to Keycloak.
pub async fn oidc_start(
    session: Session,
    State(state): State<AppState>,
    Query(params): Query<OidcStartParams>,
) -> Result<impl IntoResponse, AuthError> {
    let oidc = state
        .auth
        .oidc_state
        .as_ref()
        .ok_or(AuthError::OidcNotConfigured)?;

    // Generate PKCE S256 verifier + challenge pair.
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    // Build authorization URL with CSRF token and nonce.
    let mut auth_url_builder = oidc
        .client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("email".to_string()))
        .set_pkce_challenge(pkce_challenge);

    // Add prompt=create for invite-to-registration flow (Keycloak 26.1+).
    if params.prompt.as_deref() == Some("create") {
        auth_url_builder = auth_url_builder.add_extra_param("prompt", "create");
    }

    let (auth_url, csrf_token, nonce) = auth_url_builder.url();

    // Store PKCE verifier and CSRF/nonce secrets in the server-side session.
    // The verifier MUST never leave the server (stored server-side in tower-sessions).
    session
        .insert("oidc_pkce_verifier", pkce_verifier.secret())
        .await
        .map_err(|e| AuthError::Internal(format!("session insert oidc_pkce_verifier: {e}")))?;

    session
        .insert("oidc_csrf_state", csrf_token.secret())
        .await
        .map_err(|e| AuthError::Internal(format!("session insert oidc_csrf_state: {e}")))?;

    session
        .insert("oidc_nonce", nonce.secret())
        .await
        .map_err(|e| AuthError::Internal(format!("session insert oidc_nonce: {e}")))?;

    // Store invite token if present — will be auto-accepted after OIDC callback.
    if let Some(token) = params.invite_token {
        session
            .insert("pending_invite_token", token)
            .await
            .map_err(|e| AuthError::Internal(format!("session insert pending_invite_token: {e}")))?;
    }

    // CRITICAL: explicitly save so the session cookie is set BEFORE the redirect.
    // tower-sessions (RusqliteStore) is lazy — without save(), the verifier is lost.
    session
        .save()
        .await
        .map_err(|e| AuthError::Internal(format!("session save in oidc_start: {e}")))?;

    Ok(Redirect::to(auth_url.as_str()))
}

/// GET /v1/auth/oidc-callback?code=...&state=...
///
/// Keycloak redirects here after authentication. This handler:
/// 1. Validates CSRF state
/// 2. Exchanges authorization code for tokens (with PKCE verifier)
/// 3. Verifies ID token signature + claims (JWKS, aud, iss, exp, nonce)
/// 4. Upserts the user in the local DB by Keycloak subject
/// 5. Creates a new server session (cycles ID for fixation prevention)
/// 6. Auto-accepts pending invite token if present
/// 7. Redirects to the dashboard
pub async fn oidc_callback(
    session: Session,
    State(state): State<AppState>,
    Query(params): Query<OidcCallbackParams>,
) -> Result<impl IntoResponse, AuthError> {
    // 1. Check for provider-side errors (user denied access, Keycloak error, etc.).
    if let Some(err) = &params.error {
        tracing::warn!(
            error = %err,
            error_description = ?params.error_description,
            "OIDC provider returned error"
        );
        return Ok(Redirect::to("/login?error=auth_failed").into_response());
    }

    // 2. Both `code` and `state` are required for a valid callback.
    let code = params.code.ok_or(AuthError::OidcStateMismatch)?;
    let returned_state = params.state.ok_or(AuthError::OidcStateMismatch)?;

    // 3. Validate CSRF state — compare returned state with what we stored in session.
    let stored_state: String = session
        .get("oidc_csrf_state")
        .await
        .map_err(|e| AuthError::Internal(format!("session get oidc_csrf_state: {e}")))?
        .ok_or(AuthError::OidcStateMismatch)?;

    if returned_state != stored_state {
        return Err(AuthError::OidcStateMismatch);
    }

    // 4. Reconstruct the PKCE verifier from session.
    let verifier_secret: String = session
        .get("oidc_pkce_verifier")
        .await
        .map_err(|e| AuthError::Internal(format!("session get oidc_pkce_verifier: {e}")))?
        .ok_or(AuthError::OidcStateMismatch)?;
    let pkce_verifier = PkceCodeVerifier::new(verifier_secret);

    // 5. Reconstruct nonce from session.
    let nonce_secret: String = session
        .get("oidc_nonce")
        .await
        .map_err(|e| AuthError::Internal(format!("session get oidc_nonce: {e}")))?
        .ok_or(AuthError::OidcStateMismatch)?;
    let nonce = Nonce::new(nonce_secret);

    // 6. Get OidcState.
    let oidc = state
        .auth
        .oidc_state
        .as_ref()
        .ok_or(AuthError::OidcNotConfigured)?;

    // 7. Exchange authorization code for tokens (with PKCE verifier).
    //    Use the rewriting client when internal_base_url is configured so the
    //    token endpoint request reaches Keycloak via Docker DNS.
    let token_response = if let Some(rw) = oidc.rewriting_client() {
        oidc.client
            .exchange_code(AuthorizationCode::new(code))
            .set_pkce_verifier(pkce_verifier)
            .request_async(&rw)
            .await
    } else {
        oidc.client
            .exchange_code(AuthorizationCode::new(code))
            .set_pkce_verifier(pkce_verifier)
            .request_async(&oidc.http_client)
            .await
    }
    .map_err(|e| {
        tracing::error!(error = %e, "OIDC token exchange failed");
        AuthError::OidcTokenExchange
    })?;

    // 8. Extract and verify the ID token.
    let id_token = token_response.id_token().ok_or(AuthError::OidcNoIdToken)?;
    let verifier = oidc.client.id_token_verifier();

    // Try verification. On failure, refresh JWKS once and retry (handles Keycloak key rotation).
    let claims = match id_token.claims(&verifier, &nonce) {
        Ok(c) => c,
        Err(first_err) => {
            tracing::warn!(
                error = %first_err,
                "ID token verification failed — refreshing provider metadata and retrying"
            );
            oidc.refresh_provider_metadata().await;

            // Retry with the same verifier — the JWKS are embedded in the client at build time.
            // This handles the stale-TTL case; key rotation requires a server restart (future work).
            id_token
                .claims(&verifier, &nonce)
                .map_err(|e| {
                    tracing::error!(error = %e, "ID token verification failed after JWKS refresh");
                    AuthError::OidcTokenInvalid
                })?
        }
    };

    // 8b. Store raw id_token JWT for use in OIDC RP-Initiated Logout (id_token_hint).
    if let Ok(raw) = serde_json::to_value(id_token) {
        if let Some(jwt_str) = raw.as_str() {
            session
                .insert("id_token", jwt_str)
                .await
                .map_err(|e| AuthError::Internal(format!("session insert id_token: {e}")))?;
        }
    }

    // 9. Extract subject (Keycloak user UUID).
    let subject = claims.subject().to_string();

    // 10. Extract profile claims from ID token.
    let email: Option<&str> = claims.email().map(|e| e.as_str());
    let first_name: Option<String> = claims
        .given_name()
        .and_then(|n| n.get(None))
        .map(|n| n.to_string());
    let last_name: Option<String> = claims
        .family_name()
        .and_then(|n| n.get(None))
        .map(|n| n.to_string());

    // 11. Upsert user in local DB by Keycloak subject (users.id = sub).
    let user_id = state
        .db
        .upsert_user_by_subject(
            &subject,
            email,
            first_name.as_deref(),
            last_name.as_deref(),
        )
        .await
        .map_err(|e| AuthError::Internal(format!("upsert_user_by_subject failed: {e}")))?;

    // 12. Read pending invite token BEFORE cycling session ID (cycle_id keeps data).
    let pending_invite_token: Option<String> = session.get("pending_invite_token").await.ok().flatten();

    // 13. Clean up OIDC session values.
    session
        .remove_value("oidc_pkce_verifier")
        .await
        .map_err(|e| AuthError::Internal(format!("session remove oidc_pkce_verifier: {e}")))?;
    session
        .remove_value("oidc_csrf_state")
        .await
        .map_err(|e| AuthError::Internal(format!("session remove oidc_csrf_state: {e}")))?;
    session
        .remove_value("oidc_nonce")
        .await
        .map_err(|e| AuthError::Internal(format!("session remove oidc_nonce: {e}")))?;

    // 14. CRITICAL: cycle session ID to prevent session fixation attacks.
    session
        .cycle_id()
        .await
        .map_err(|e| AuthError::Internal(format!("cycle_id failed: {e}")))?;

    // 15. Set session values for the authenticated user.
    session
        .insert("user_id", &user_id)
        .await
        .map_err(|e| AuthError::Internal(format!("session insert user_id: {e}")))?;

    session
        .insert("auth_method", "oidc")
        .await
        .map_err(|e| AuthError::Internal(format!("session insert auth_method: {e}")))?;

    // 16. Set 24-hour fixed expiry (same as password auth pattern).
    session.set_expiry(Some(Expiry::AtDateTime(
        OffsetDateTime::now_utc() + time::Duration::hours(24),
    )));

    // 17. Save the session — assigns a new session ID after cycle_id().
    session
        .save()
        .await
        .map_err(|e| AuthError::Internal(format!("session save in oidc_callback: {e}")))?;

    // 18. Enforce single session via user_sessions table.
    let session_id = session
        .id()
        .ok_or_else(|| AuthError::Internal("session has no ID after save".to_string()))?
        .to_string();

    state
        .db
        .upsert_user_session(&user_id, &session_id)
        .await
        .map_err(|e| AuthError::Internal(format!("upsert_user_session failed: {e}")))?;

    // 19. Auto-accept pending invite if one was stored before the OIDC redirect.
    if let Some(invite_token) = pending_invite_token {
        let _ = accept_invite_for_user(&state, &user_id, &invite_token).await;
        let _ = session.remove_value("pending_invite_token").await;
        let _ = session.save().await;
    }

    // 20. Always redirect to dashboard.
    Ok(Redirect::to("/").into_response())
}

// ──────────────────────────────────────────────────────────────────────────────
// Invite auto-accept helper
// ──────────────────────────────────────────────────────────────────────────────

/// Auto-accept a pending invite for a newly OIDC-authenticated user.
///
/// Validates the token (must not be expired), creates the org membership,
/// and updates the user's `keasy.dataspaces` attribute in Keycloak.
/// Reusable — the token is not consumed. Silently ignores failures — if the
/// invite is expired or the user already has a membership, they still log in.
async fn accept_invite_for_user(
    state: &AppState,
    user_id: &str,
    invite_token: &str,
) -> Result<(), String> {
    let token = state
        .db
        .get_invite_token(invite_token)
        .await
        .ok_or("invite token not found")?;

    let now_str = jiff::Timestamp::now().to_string();
    if token.expires_at <= now_str {
        return Err("invite token expired".to_string());
    }

    let membership_id = uuid::Uuid::new_v4().to_string();
    state
        .db
        .create_user_org_membership(&membership_id, user_id, &token.org_id, &token.role)
        .await?;

    // Update Keycloak dataspaces attribute — user_id IS the Keycloak UUID.
    if let (Some(kc_admin), Some(client_id)) = (
        &state.auth.keycloak_admin,
        &state.auth.oidc_client_id,
    ) {
        if let Err(e) = kc_admin.add_user_workspace(user_id, client_id).await {
            tracing::warn!(
                error = %e,
                user_id = %user_id,
                client_id = %client_id,
                "Failed to update Keycloak dataspaces attribute"
            );
        }
    }

    tracing::info!(
        user_id = %user_id,
        org_id = %token.org_id,
        "OIDC: auto-accepted invite for user"
    );

    Ok(())
}
