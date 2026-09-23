//! Bearer-token validation against the realm's JWKS.
//!
//! This server is a **resource server** and nothing else: it obtains no
//! credential, redirects nobody, and holds no session. The relying party is the
//! web BFF (`@kanzo-tech/auth/next`), which keeps the tokens and forwards one on
//! every call it proxies. What is left here is the half the package's Keycloak
//! page states in words rather than code, because the resource servers it talks
//! about are not written in TypeScript:
//!
//! | | |
//! | --- | --- |
//! | `iss` | exactly the realm's issuer |
//! | `aud` | contains this API's audience |
//! | `exp` | not past |
//! | `nbf` | not future, when the token carries one |
//! | signature | against the realm's JWKS, keyed by `kid` and cached |
//!
//! Both time checks are read with [`CLOCK_LEEWAY`] of slack, which is this
//! deployment's number rather than a library default.
//!
//! Plus one this deployment adds, because a workspace is an instance rather than
//! an organization: `azp` must be **this** workspace's client. Every tenant has
//! its own Keycloak client, so a token minted for `keasy-ws-a` naming the shared
//! API audience would otherwise be spendable at `keasy-ws-b` — the roles would
//! not match and the request would fail anyway, but failing on the *credential*
//! is the check that says why.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{AlgorithmFamily, DecodingKey, Validation, decode, decode_header};
use tokio::sync::RwLock;

/// How long to wait for a TCP connection to the realm.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// How long to wait for one whole answer from the realm, body included.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// The shortest interval between two attempts to re-fetch the realm's keys.
///
/// Thirty seconds is `jose`'s `createRemoteJWKSet` default for the same
/// mechanism (`cooldownDuration`: "time in milliseconds after a successful fetch
/// before a missing key can trigger another fetch"), and the tradeoff is the
/// same here: long enough that an unknown `kid` is not a lever on Keycloak,
/// short enough that a realm key rotation is picked up within one of these
/// rather than on a restart.
const REFETCH_COOLDOWN: Duration = Duration::from_secs(30);

/// How far this server's clock may disagree with the realm's before `exp` and
/// `nbf` are read differently. Explicit rather than `jsonwebtoken`'s inherited
/// sixty-second default.
const CLOCK_LEEWAY: Duration = Duration::from_secs(30);

/// The claims this server authorizes on. Everything else in the token is ignored.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Claims {
    /// The Keycloak user id. Stable, and never an email.
    pub sub: String,
    /// The client the token was issued to — this workspace's, or the request is refused.
    #[serde(default)]
    pub azp: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub given_name: Option<String>,
    #[serde(default)]
    pub family_name: Option<String>,
    /// Slugs of every workspace this user belongs to — feeds the switcher. A
    /// per-user Keycloak attribute mapper emits it.
    #[serde(default)]
    pub workspaces: Vec<String>,
    /// Keycloak's own client-role claim. `resource_access.<client_id>.roles` is
    /// what the realm publishes for free; renaming it into something like
    /// `keasy:role` was this codebase's own invention and is gone.
    #[serde(default)]
    pub resource_access: HashMap<String, RoleSet>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct RoleSet {
    #[serde(default)]
    pub roles: Vec<String>,
}

impl Claims {
    /// The roles this person holds **in this application**, and nowhere else. A
    /// role granted on another client authorizes nothing here.
    pub fn roles_for(&self, client_id: &str) -> &[String] {
        self.resource_access
            .get(client_id)
            .map(|r| r.roles.as_slice())
            .unwrap_or_default()
    }
}

/// Why a credential was refused. Opaque to the caller, specific in the log.
#[derive(Debug, thiserror::Error)]
pub enum TokenError {
    /// No `Authorization: Bearer` at all.
    #[error("auth/token_missing")]
    Missing,
    /// Present, but it does not verify: signature, `iss`, `aud`, `exp`, or shape.
    #[error("auth/token_invalid")]
    Invalid,
    /// Verified, but issued to another workspace's client.
    #[error("auth/token_foreign")]
    Foreign,
    /// The realm's keys could not be reached. Not the caller's fault — say 503.
    #[error("auth/keys_unavailable")]
    KeysUnavailable,
}

impl axum::response::IntoResponse for TokenError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        let (status, code, message) = match self {
            TokenError::Missing | TokenError::Invalid | TokenError::Foreign => (
                StatusCode::UNAUTHORIZED,
                "auth/session_required",
                "Authentication required",
            ),
            TokenError::KeysUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "auth/keys_unavailable",
                "The identity provider is unreachable",
            ),
        };
        (status, axum::Json(crate::error::error_body(code, message))).into_response()
    }
}

#[derive(serde::Deserialize)]
struct Discovery {
    jwks_uri: String,
}

pub struct Validator {
    /// The **public** issuer, exactly as it appears in the token's `iss`.
    issuer: String,
    /// This API's audience. The tenant client carries an audience mapper naming it.
    audience: String,
    /// This workspace's Keycloak client: the expected `azp`, and the key into
    /// `resource_access` that carries the roles.
    client_id: String,
    /// Where *this process* reaches Keycloak when that is not where the browser
    /// does — `http://keycloak:8080`. Only the origin is replaced; the path is
    /// the issuer's own, so discovery still validates against the public URL.
    internal_origin: Option<String>,
    http: reqwest::Client,
    keys: RwLock<Option<JwkSet>>,
    /// The gate on re-fetching, and when the last attempt was made. One lock
    /// does both jobs: holding it is what makes a re-fetch single-flight, and
    /// what it holds is what makes the cooldown a floor. The read path — a `kid`
    /// already in `keys` — never touches it.
    refetch: tokio::sync::Mutex<Option<Instant>>,
}

impl Validator {
    /// Infallible on purpose: Keycloak is routinely not up when this process is,
    /// and a constructor that discovered would make that a boot failure. The
    /// keys are fetched on the first request that needs them, and again on the
    /// first `kid` they do not carry.
    pub fn new(
        issuer: &str,
        audience: &str,
        client_id: &str,
        internal_origin: Option<&str>,
    ) -> Self {
        Self {
            issuer: issuer.trim_end_matches('/').to_string(),
            audience: audience.to_string(),
            client_id: client_id.to_string(),
            internal_origin: internal_origin.map(|o| o.trim_end_matches('/').to_string()),
            http: Self::http_client(),
            keys: RwLock::new(None),
            refetch: tokio::sync::Mutex::new(None),
        }
    }

    /// The client the realm is asked over, and the reason it is not the default.
    ///
    /// `reqwest::Client::new()` has no timeout at all, and the failure that
    /// matters is not a Keycloak that is *down* — that refuses the connection
    /// and comes back as a 503 in milliseconds — but a Keycloak that is *hung*:
    /// accepting connections and never answering. With no deadline, the Axum
    /// handler waiting on this waits forever, and enough of them take the whole
    /// server down with a realm that is still nominally up.
    ///
    /// Both bounds are deliberate. [`CONNECT_TIMEOUT`] is generous for a TCP
    /// handshake to a container on the same network and short enough that a
    /// black-holed address is not mistaken for a slow one. [`REQUEST_TIMEOUT`]
    /// is the whole round trip including the body, applied per request — so
    /// `fetch_keys`, which makes two, is bounded at twice that, and that is the
    /// longest a request can be held by the realm.
    fn http_client() -> reqwest::Client {
        reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            // Only the TLS backend can fail here, and it is compiled in.
            .expect("the rustls backend builds")
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    /// A public URL as this process can reach it.
    fn reachable(&self, url: &str) -> String {
        let Some(internal) = &self.internal_origin else {
            return url.to_string();
        };
        let Ok(public) = url::Url::parse(&self.issuer) else {
            return url.to_string();
        };
        let origin = public.origin().ascii_serialization();
        match url.strip_prefix(&origin) {
            Some(rest) => format!("{internal}{rest}"),
            None => url.to_string(),
        }
    }

    async fn fetch_keys(&self) -> Result<JwkSet, TokenError> {
        let discovery_url =
            self.reachable(&format!("{}/.well-known/openid-configuration", self.issuer));
        let discovery: Discovery = self
            .http
            .get(&discovery_url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| {
                tracing::warn!(error = %e, url = %discovery_url, "OIDC discovery failed");
                TokenError::KeysUnavailable
            })?
            .json()
            .await
            .map_err(|e| {
                tracing::warn!(error = %e, "OIDC discovery document is not the shape we expect");
                TokenError::KeysUnavailable
            })?;

        let jwks_url = self.reachable(&discovery.jwks_uri);
        self.http
            .get(&jwks_url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| {
                tracing::warn!(error = %e, url = %jwks_url, "JWKS fetch failed");
                TokenError::KeysUnavailable
            })?
            .json()
            .await
            .map_err(|e| {
                tracing::warn!(error = %e, "JWKS is not a key set");
                TokenError::KeysUnavailable
            })
    }

    /// The key for `kid` out of the cached set, if it is in there.
    async fn cached(&self, kid: &str) -> Result<Option<DecodingKey>, TokenError> {
        let keys = self.keys.read().await;
        let Some(jwk) = keys.as_ref().and_then(|set| set.find(kid)) else {
            return Ok(None);
        };
        DecodingKey::from_jwk(jwk).map(Some).map_err(|e| {
            tracing::warn!(error = %e, kid, "JWKS holds a key we cannot decode");
            TokenError::Invalid
        })
    }

    /// The key for `kid`, re-fetching the set when it is not there.
    ///
    /// Reactive rather than on a timer: Keycloak rotates its realm keys, and a
    /// refresh every few minutes is a request that is wrong exactly when it
    /// matters. What was missing under the re-fetch was a floor. A `kid` is
    /// unauthenticated input — it comes out of a JWT header that nobody has
    /// verified yet — so an unknown one triggering two requests to the realm,
    /// with no ceiling, hands anybody with a socket an amplifier against
    /// Keycloak. Signing nothing and inventing a `kid` per request is enough.
    ///
    /// Two things put a floor under it, and they are the same lock. Holding
    /// `refetch` across the fetch makes it single-flight: a hundred requests
    /// arriving on a cold cache produce one fetch and then find the key, rather
    /// than a hundred fetches or ninety-nine spurious refusals. And the `Instant`
    /// it holds is a cooldown: a second attempt within [`REFETCH_COOLDOWN`] is
    /// answered from what we already know instead of asked of the realm. The
    /// cooldown is what an attacker runs into; the single flight is what
    /// legitimate traffic runs into, and it costs them nothing.
    ///
    /// The refusal says which kind of ignorance it is. No key set at all means
    /// we never reached the realm — that is a 503, not a verdict on the
    /// credential. A key set without this `kid` is a verdict: 401.
    async fn key_for(&self, kid: &str) -> Result<DecodingKey, TokenError> {
        if let Some(key) = self.cached(kid).await? {
            return Ok(key);
        }

        let mut last_attempt = self.refetch.lock().await;

        // Whoever held the gate before us may have fetched exactly this key.
        if let Some(key) = self.cached(kid).await? {
            return Ok(key);
        }

        if let Some(at) = *last_attempt
            && at.elapsed() < REFETCH_COOLDOWN
        {
            let have_keys = self.keys.read().await.is_some();
            tracing::warn!(
                kid,
                have_keys,
                "unknown `kid` inside the JWKS re-fetch cooldown; refusing without asking the realm"
            );
            return Err(if have_keys {
                TokenError::Invalid
            } else {
                TokenError::KeysUnavailable
            });
        }
        *last_attempt = Some(Instant::now());

        let fetched = self.fetch_keys().await?;
        let key = fetched
            .find(kid)
            .map(DecodingKey::from_jwk)
            .transpose()
            .map_err(|e| {
                tracing::warn!(error = %e, kid, "JWKS holds a key we cannot decode");
                TokenError::Invalid
            })?;
        *self.keys.write().await = Some(fetched);

        key.ok_or_else(|| {
            tracing::warn!(kid, "token signed by a key the realm does not publish");
            TokenError::Invalid
        })
    }

    /// Verify a bearer token and answer with the claims it carries.
    pub async fn verify(&self, token: &str) -> Result<Claims, TokenError> {
        let header = decode_header(token).map_err(|e| {
            tracing::debug!(error = %e, "bearer token is not a JWT");
            TokenError::Invalid
        })?;
        let kid = header.kid.ok_or_else(|| {
            tracing::debug!("bearer token carries no `kid`, so no key can be selected");
            TokenError::Invalid
        })?;

        // The token says which algorithm it was signed with, which is the
        // classic place to be lied to — so the *family* is what we take from it
        // and the key is what settles the rest: `decode` refuses a token whose
        // family is not its key's, and a JWKS entry for an asymmetric key can
        // never be read as an HMAC secret. Refusing the HMAC family here closes
        // the question one step earlier, at the only family a realm never signs
        // with and an attacker would most like us to accept.
        let family = header.alg.family();
        if family == AlgorithmFamily::Hmac {
            tracing::warn!(
                "bearer token claims a symmetric signature; a realm does not sign that way"
            );
            return Err(TokenError::Invalid);
        }

        let key = self.key_for(&kid).await?;

        // Every algorithm in the list must belong to one family — `jsonwebtoken`
        // refuses a mixed list outright rather than picking the matching one.
        let mut validation = Validation::new_for_family(family);
        validation.set_issuer(&[&self.issuer]);
        validation.set_audience(&[&self.audience]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);

        // A token that says it is not valid yet is not valid yet. `jsonwebtoken`
        // leaves `nbf` unchecked by default, which means a token minted ahead of
        // time — Keycloak will not do it, but this is the check that says so
        // rather than assuming it — was being spent early.
        validation.validate_nbf = true;

        // And the tolerance both time checks are read with, written down instead
        // of inherited. The default is sixty seconds; thirty is half the window
        // an expired token keeps working and still far more drift than two
        // NTP-synced containers in the same deployment will ever have between
        // them. It is a number this product chose, which is the point.
        validation.leeway = CLOCK_LEEWAY.as_secs();

        let claims = decode::<Claims>(token, &key, &validation)
            .map_err(|e| {
                tracing::debug!(error = %e, "bearer token did not validate");
                TokenError::Invalid
            })?
            .claims;

        if claims.azp.as_deref() != Some(self.client_id.as_str()) {
            tracing::warn!(
                azp = ?claims.azp,
                expected = %self.client_id,
                "bearer token was issued to another workspace's client"
            );
            return Err(TokenError::Foreign);
        }

        Ok(claims)
    }
}

/// The bearer token on a request, if there is one.
pub fn bearer(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

pub type SharedValidator = Arc<Validator>;

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    fn validator() -> Validator {
        Validator::new(
            "https://id.example/auth/realms/keasy",
            "keasy-api",
            "keasy-ws-dev",
            Some("http://keycloak:8080"),
        )
    }

    #[test]
    fn rewrites_only_the_public_origin() {
        let v = validator();
        assert_eq!(
            v.reachable("https://id.example/auth/realms/keasy/protocol/openid-connect/certs"),
            "http://keycloak:8080/auth/realms/keasy/protocol/openid-connect/certs"
        );
        // A URL from somewhere else is left exactly as the realm published it.
        assert_eq!(
            v.reachable("https://elsewhere/keys"),
            "https://elsewhere/keys"
        );
    }

    #[test]
    fn without_an_internal_origin_nothing_is_rewritten() {
        let v = Validator::new(
            "https://id.example/realms/keasy",
            "keasy-api",
            "keasy",
            None,
        );
        assert_eq!(
            v.reachable("https://id.example/realms/keasy/certs"),
            "https://id.example/realms/keasy/certs"
        );
    }

    #[test]
    fn roles_are_read_per_client_and_never_merged() {
        let claims: Claims = serde_json::from_value(serde_json::json!({
            "sub": "u-1",
            "resource_access": {
                "keasy-ws-dev": { "roles": ["owner"] },
                "keasy-ws-other": { "roles": ["member"] }
            }
        }))
        .unwrap();
        assert_eq!(claims.roles_for("keasy-ws-dev"), ["owner"]);
        assert_eq!(claims.roles_for("keasy-ws-other"), ["member"]);
        assert!(claims.roles_for("keasy-ws-absent").is_empty());
    }

    // ── Against a realm ───────────────────────────────────────────────────
    //
    // A fake Keycloak: a P-256 key, a discovery document and a JWKS served over
    // a real socket. Everything below mints a genuinely signed token and asks
    // the validator what it makes of it — which is the only way to test a
    // signature check, an `aud` check and a key rotation at all.

    use axum::{Json, Router, routing::get};
    use jsonwebtoken::jwk::{Jwk, JwkSet};
    use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
    use serde_json::json;

    struct Realm {
        issuer: String,
        key: EncodingKey,
        kid: String,
        /// Every request this realm has served. What the cooldown is asserted on:
        /// a floor is only a floor if it shows up as requests not made.
        hits: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl Realm {
        fn requests(&self) -> usize {
            self.hits.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    /// Serve a discovery document and a JWKS holding `kid`, and answer with the
    /// issuer they were published at.
    async fn realm(kid: &str) -> Realm {
        let pair = rcgen::KeyPair::generate().unwrap();
        let key = EncodingKey::from_ec_pem(pair.serialize_pem().as_bytes()).unwrap();
        let mut jwk = Jwk::from_encoding_key(&key, Algorithm::ES256).unwrap();
        jwk.common.key_id = Some(kid.to_string());

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let issuer = format!("http://{}/realms/keasy", listener.local_addr().unwrap());

        let jwks = serde_json::to_value(JwkSet { keys: vec![jwk] }).unwrap();
        let discovery = json!({ "issuer": issuer, "jwks_uri": format!("{issuer}/certs") });

        let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (on_discovery, on_certs) = (hits.clone(), hits.clone());
        let app = Router::new()
            .route(
                "/realms/keasy/.well-known/openid-configuration",
                get(move || {
                    on_discovery.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    async move { Json(discovery) }
                }),
            )
            .route(
                "/realms/keasy/certs",
                get(move || {
                    on_certs.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    async move { Json(jwks) }
                }),
            );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        Realm {
            issuer,
            key,
            kid: kid.to_string(),
            hits,
        }
    }

    fn mint(realm: &Realm, claims: serde_json::Value) -> String {
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(realm.kid.clone());
        encode(&header, &claims, &realm.key).unwrap()
    }

    fn in_an_hour() -> i64 {
        jiff::Timestamp::now().as_second() + 3600
    }

    /// Everything a good token carries, before a test spoils one field of it.
    fn good(realm: &Realm) -> serde_json::Value {
        json!({
            "sub": "u-1",
            "iss": realm.issuer,
            "aud": ["keasy-api", "keasy-ws-dev"],
            "azp": "keasy-ws-dev",
            "exp": in_an_hour(),
            "email": "dev@keasy.local",
            "workspaces": ["dev", "acme"],
            "resource_access": { "keasy-ws-dev": { "roles": ["owner"] } },
        })
    }

    fn validating(realm: &Realm) -> Validator {
        Validator::new(&realm.issuer, "keasy-api", "keasy-ws-dev", None)
    }

    #[tokio::test]
    async fn a_token_the_realm_signed_is_accepted_and_read() {
        let realm = realm("k1").await;
        let claims = validating(&realm)
            .verify(&mint(&realm, good(&realm)))
            .await
            .expect("a well-formed token from this realm");

        assert_eq!(claims.sub, "u-1");
        assert_eq!(claims.email.as_deref(), Some("dev@keasy.local"));
        assert_eq!(claims.workspaces, ["dev", "acme"]);
        assert_eq!(claims.roles_for("keasy-ws-dev"), ["owner"]);
    }

    #[tokio::test]
    async fn a_token_that_does_not_name_this_api_is_refused() {
        let realm = realm("k1").await;
        let mut claims = good(&realm);
        claims["aud"] = json!(["keasy-ws-dev"]);

        assert!(matches!(
            validating(&realm).verify(&mint(&realm, claims)).await,
            Err(TokenError::Invalid)
        ));
    }

    #[tokio::test]
    async fn a_token_from_another_issuer_is_refused() {
        let realm = realm("k1").await;
        let mut claims = good(&realm);
        claims["iss"] = json!("https://elsewhere/realms/keasy");

        assert!(matches!(
            validating(&realm).verify(&mint(&realm, claims)).await,
            Err(TokenError::Invalid)
        ));
    }

    #[tokio::test]
    async fn an_expired_token_is_refused() {
        let realm = realm("k1").await;
        let mut claims = good(&realm);
        // Well past the validator's sixty seconds of leeway.
        claims["exp"] = json!(jiff::Timestamp::now().as_second() - 3600);

        assert!(matches!(
            validating(&realm).verify(&mint(&realm, claims)).await,
            Err(TokenError::Invalid)
        ));
    }

    /// The tenancy check, and the reason it is separate from `aud`.
    ///
    /// This token is valid, unexpired, and names this API — a sibling workspace
    /// in the same realm minted it. Its roles would come up empty here anyway,
    /// but refusing on the credential says *why* instead of looking like an
    /// authorization failure.
    #[tokio::test]
    async fn a_token_minted_for_another_workspace_is_refused() {
        let realm = realm("k1").await;
        let mut claims = good(&realm);
        claims["azp"] = json!("keasy-ws-other");
        claims["resource_access"] = json!({ "keasy-ws-other": { "roles": ["owner"] } });

        assert!(matches!(
            validating(&realm).verify(&mint(&realm, claims)).await,
            Err(TokenError::Foreign)
        ));
    }

    /// A forgery signed with somebody else's key, wearing a `kid` this realm
    /// does publish. The re-fetch finds the real key, and the signature fails
    /// against it.
    #[tokio::test]
    async fn a_token_signed_by_another_key_is_refused() {
        let forger = realm("k1").await;
        let ours = realm("k1").await;

        let forged = mint(&forger, good(&ours));
        assert!(matches!(
            validating(&ours).verify(&forged).await,
            Err(TokenError::Invalid)
        ));
    }

    #[tokio::test]
    async fn a_kid_the_realm_does_not_publish_is_refused() {
        let stranger = realm("k2").await;
        let ours = realm("k1").await;

        // Signed by a key this realm never had, and announcing a `kid` it has
        // never published — one re-fetch, then a refusal.
        let alien = mint(&stranger, good(&ours));
        assert!(matches!(
            validating(&ours).verify(&alien).await,
            Err(TokenError::Invalid)
        ));
    }

    /// The amplifier that unknown `kid`s used to be. A `kid` is unauthenticated
    /// input, and each unknown one cost the realm two requests with nothing
    /// bounding how many an anonymous caller could ask for.
    #[tokio::test]
    async fn an_unknown_kid_is_not_a_lever_on_the_realm() {
        let stranger = realm("k2").await;
        let ours = realm("k1").await;
        let validator = validating(&ours);
        let alien = mint(&stranger, good(&ours));

        // Cold cache: the realm is asked, once, for discovery and for the keys.
        assert!(matches!(
            validator.verify(&alien).await,
            Err(TokenError::Invalid)
        ));
        assert_eq!(ours.requests(), 2);

        // Fifty more of the same, all refused, none of them asked of the realm.
        for _ in 0..50 {
            assert!(matches!(
                validator.verify(&alien).await,
                Err(TokenError::Invalid)
            ));
        }
        assert_eq!(ours.requests(), 2, "the cooldown held");

        // And the floor costs a real token nothing: its `kid` is in the set the
        // first refusal fetched, so it verifies without another word to Keycloak.
        validator
            .verify(&mint(&ours, good(&ours)))
            .await
            .expect("a token this realm signed");
        assert_eq!(ours.requests(), 2);
    }

    /// Concurrency, from the other side: a cold cache and a crowd of *valid*
    /// tokens must produce one fetch and no spurious refusals. The cooldown
    /// alone would refuse everyone who lost the race, so the same lock is what
    /// makes the fetch single-flight.
    #[tokio::test]
    async fn a_cold_cache_under_load_fetches_once_and_refuses_nobody() {
        let ours = realm("k1").await;
        let validator = Arc::new(validating(&ours));
        let token = Arc::new(mint(&ours, good(&ours)));

        let mut waiting = Vec::new();
        for _ in 0..25 {
            let (validator, token) = (validator.clone(), token.clone());
            waiting.push(tokio::spawn(async move {
                validator.verify(&token).await.is_ok()
            }));
        }
        for handle in waiting {
            assert!(handle.await.unwrap(), "every valid token verifies");
        }
        assert_eq!(
            ours.requests(),
            2,
            "one discovery, one JWKS, for all of them"
        );
    }

    /// `nbf` was not checked at all: `jsonwebtoken` leaves it off by default, so
    /// a token minted for later was spendable now.
    #[tokio::test]
    async fn a_token_that_is_not_valid_yet_is_refused() {
        let realm = realm("k1").await;
        let mut claims = good(&realm);
        claims["nbf"] = json!(jiff::Timestamp::now().as_second() + 3600);

        assert!(matches!(
            validating(&realm).verify(&mint(&realm, claims)).await,
            Err(TokenError::Invalid)
        ));
    }

    /// The leeway, asserted rather than assumed: a token that went out of date
    /// a moment ago is still taken, one past the window is not.
    #[tokio::test]
    async fn the_clock_leeway_is_the_one_we_chose() {
        let realm = realm("k1").await;
        let now = jiff::Timestamp::now().as_second();
        let leeway = CLOCK_LEEWAY.as_secs() as i64;

        let mut just_inside = good(&realm);
        just_inside["exp"] = json!(now - (leeway / 2));
        assert!(
            validating(&realm)
                .verify(&mint(&realm, just_inside))
                .await
                .is_ok()
        );

        let mut just_outside = good(&realm);
        just_outside["exp"] = json!(now - (leeway * 2));
        assert!(matches!(
            validating(&realm).verify(&mint(&realm, just_outside)).await,
            Err(TokenError::Invalid)
        ));
    }

    /// Algorithm confusion: a token signed with HMAC, hoping the verifier will
    /// take the realm's published public key as the shared secret.
    #[tokio::test]
    async fn a_symmetrically_signed_token_is_refused() {
        let ours = realm("k1").await;

        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some("k1".to_string());
        let forged = encode(
            &header,
            &good(&ours),
            &EncodingKey::from_secret(b"whatever the attacker guessed"),
        )
        .unwrap();

        assert!(matches!(
            validating(&ours).verify(&forged).await,
            Err(TokenError::Invalid)
        ));
    }

    #[tokio::test]
    async fn an_unreachable_realm_is_a_503_rather_than_a_401() {
        // Nothing is listening: a credential we cannot check is not a credential
        // we have judged.
        let validator = Validator::new(
            "http://127.0.0.1:1/realms/keasy",
            "keasy-api",
            "keasy",
            None,
        );
        let signed = {
            let realm = realm("k1").await;
            mint(&realm, good(&realm))
        };

        assert!(matches!(
            validator.verify(&signed).await,
            Err(TokenError::KeysUnavailable)
        ));
    }

    /// The failure a missing timeout actually produces. Nothing is refused and
    /// nothing is answered: the realm accepts the connection and then says
    /// nothing at all, which is what a wedged Keycloak looks like from here. A
    /// client with no deadline parks the Axum handler on this forever.
    #[tokio::test]
    async fn a_realm_that_accepts_and_never_answers_is_a_503_too() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let issuer = format!("http://{}/realms/keasy", listener.local_addr().unwrap());
        let app = Router::new().route(
            "/realms/keasy/.well-known/openid-configuration",
            get(std::future::pending::<Json<serde_json::Value>>),
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let validator = Validator::new(&issuer, "keasy-api", "keasy", None);
        let signed = {
            let realm = realm("k1").await;
            mint(&realm, good(&realm))
        };

        // Generously past `REQUEST_TIMEOUT`: what is asserted is that the call
        // comes back at all, and with the honest answer when it does.
        let answered = tokio::time::timeout(
            REQUEST_TIMEOUT + Duration::from_secs(10),
            validator.verify(&signed),
        )
        .await
        .expect("the validator gives up on a hung realm rather than waiting on it");

        assert!(matches!(answered, Err(TokenError::KeysUnavailable)));
    }

    #[test]
    fn reads_the_bearer_scheme_and_nothing_else() {
        let mut headers = HeaderMap::new();
        assert_eq!(bearer(&headers), None);

        headers.insert("authorization", HeaderValue::from_static("Basic abc"));
        assert_eq!(bearer(&headers), None);

        headers.insert("authorization", HeaderValue::from_static("Bearer "));
        assert_eq!(bearer(&headers), None);

        headers.insert("authorization", HeaderValue::from_static("Bearer t-1"));
        assert_eq!(bearer(&headers), Some("t-1"));
    }
}
