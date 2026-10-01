use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::IntoResponse;
use axum::{Json, Router, routing::get};
use base64::Engine;
use jsonwebtoken::jwk::{Jwk, JwkSet};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use secrecy::SecretString;
use serde_json::json;

use keasy_server::configuration::{
    AiSettings, ApplicationSettings, BrandingSettings, DatabaseSettings, OidcSettings, Settings,
};
use keasy_server::credentials::sealing::SecretKey;
use keasy_server::database::Database;
use keasy_server::domain::{
    ConnectionView, Direction, ResourceName, StorageCredentialInput, StorageTarget,
    ValidationReport,
};
use keasy_server::startup::Application;

/// The server on a free port over a fresh database, verifying tokens against
/// a fake realm; `db` is a second handle on the same file.
pub struct TestApp {
    pub address: String,
    pub client: reqwest::Client,
    pub db: Database,
    pub realm: Realm,
    _dir: tempfile::TempDir,
}

pub fn secret_key() -> SecretKey {
    SecretKey::from_base64(&base64::engine::general_purpose::STANDARD.encode([42u8; 32])).unwrap()
}

pub async fn spawn_app() -> TestApp {
    spawn_app_with(None).await
}

/// The server, relaying model calls to the gateway `ai` names.
pub async fn spawn_app_with(ai: Option<AiSettings>) -> TestApp {
    spawn(ai, BrandingSettings::default()).await
}

/// The server, wearing the look `branding` declares.
pub async fn spawn_app_branded(branding: BrandingSettings) -> TestApp {
    spawn(None, branding).await
}

async fn spawn(ai: Option<AiSettings>, branding: BrandingSettings) -> TestApp {
    let realm = realm("k1").await;
    let dir = tempfile::tempdir().unwrap();
    let database = DatabaseSettings {
        data_dir: dir.path().to_path_buf(),
        secret_key: secret_key(),
    };
    let db_path = database.path();
    let settings = Settings {
        application: ApplicationSettings {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            workspace_name: "Dev".into(),
            workspace_slug: Some("dev".into()),
            bootstrap_file: None,
            branding,
        },
        database,
        oidc: OidcSettings {
            issuer_url: realm.issuer.clone(),
            client_id: "keasy-ws-dev".into(),
            audience: "keasy-api".into(),
            internal_base_url: None,
        },
        ai,
    };
    let application = Application::build(settings).await.unwrap();
    let address = format!("http://127.0.0.1:{}", application.port());
    tokio::spawn(application.run_until_stopped(std::future::pending()));

    TestApp {
        address,
        client: reqwest::Client::builder().build().unwrap(),
        db: Database::open(&db_path, secret_key()).unwrap(),
        realm,
        _dir: dir,
    }
}

impl TestApp {
    /// A token for `u-1` carrying exactly `roles` on this workspace's client.
    pub fn token(&self, roles: &[&str]) -> String {
        self.token_for("u-1", roles)
    }

    pub fn token_for(&self, sub: &str, roles: &[&str]) -> String {
        let mut claims = good(&self.realm);
        claims["sub"] = json!(sub);
        claims["resource_access"] = json!({ "keasy-ws-dev": { "roles": roles } });
        mint(&self.realm, claims)
    }

    /// A JSON request; the status and the body.
    pub async fn send(
        &self,
        method: Method,
        path: &str,
        token: &str,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let response = self
            .client
            .request(method, format!("{}{path}", self.address))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.bytes().await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or_default())
    }

    pub async fn call(&self, method: Method, path: &str, token: Option<&str>) -> StatusCode {
        self.answer(method, path, token).await.0
    }

    /// A request with no body; the status and the `code` of the answer,
    /// when there is one.
    pub async fn answer(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
    ) -> (StatusCode, Option<String>) {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.address));
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.unwrap();
        let status = response.status();
        let code = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v["code"].as_str().map(str::to_owned));
        (status, code)
    }

    /// A stored S3 credential on `endpoint`, unprobed, created by `by`.
    pub async fn credential(&self, name: &str, endpoint: &str, by: &str) {
        keasy_server::credentials::persistence::insert(
            &*self.db.write().await,
            self.db.secret_key(),
            &ResourceName::parse(name).unwrap(),
            &s3(endpoint, "original-secret"),
            by,
            &unprobed(),
        )
        .unwrap();
    }

    /// A stored storage connection on `credential`, unprobed.
    pub async fn connection(&self, name: &str, credential: &str, direction: Direction, by: &str) {
        let target = StorageTarget {
            url: format!("s3://b/{name}/"),
            kind: Default::default(),
            direction,
        };
        let view = ConnectionView {
            name: name.into(),
            credential: credential.into(),
            target,
            created_by: by.into(),
            created_at: String::new(),
            updated_by: by.into(),
            updated_at: String::new(),
            validation: None,
        };
        keasy_server::connections::persistence::insert(&*self.db.write().await, &view, by).unwrap();
    }
}

pub fn unprobed() -> ValidationReport {
    ValidationReport {
        at: "now".into(),
        results: Vec::new(),
    }
}

pub fn s3(endpoint: &str, secret: &str) -> StorageCredentialInput {
    StorageCredentialInput::S3 {
        access_key_id: "AK".into(),
        secret_access_key: SecretString::from(secret),
        region: "us-east-1".into(),
        endpoint: Some(endpoint.into()),
        role_arn: None,
        external_id: None,
    }
}

/// Nothing listens here: a probe through it fails at once.
pub const DEAD: &str = "http://127.0.0.1:1";

/// A store that answers as S3 does, enough for LIST, PUT and DELETE: every
/// bucket is empty and every write lands.
pub async fn fake_s3() -> String {
    async fn answer(method: Method) -> axum::response::Response {
        match method {
            Method::GET => (
                [(header::CONTENT_TYPE, "application/xml")],
                r#"<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>"#,
            )
                .into_response(),
            Method::PUT => {
                let mut headers = HeaderMap::new();
                headers.insert(header::ETAG, "\"e\"".parse().unwrap());
                (StatusCode::OK, headers).into_response()
            }
            Method::DELETE => StatusCode::NO_CONTENT.into_response(),
            _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, Router::new().fallback(answer))
            .await
            .unwrap();
    });
    format!("http://{addr}")
}

// A fake Keycloak: a P-256 key, a discovery document and a JWKS served over a
// real socket. A test mints a genuinely signed token and asks the server what
// it makes of it — the only way to test a signature check, an `aud` check and
// a key rotation at all.

pub struct Realm {
    pub issuer: String,
    key: EncodingKey,
    kid: String,
    /// Every request this realm has served. What the cooldown is asserted on:
    /// a floor is only a floor if it shows up as requests not made.
    hits: Arc<AtomicUsize>,
}

impl Realm {
    pub fn requests(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

/// Serve a discovery document and a JWKS holding `kid`, and answer with the
/// issuer they were published at.
pub async fn realm(kid: &str) -> Realm {
    let pair = rcgen::KeyPair::generate().unwrap();
    let key = EncodingKey::from_ec_pem(pair.serialize_pem().as_bytes()).unwrap();
    let mut jwk = Jwk::from_encoding_key(&key, Algorithm::ES256).unwrap();
    jwk.common.key_id = Some(kid.to_string());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let issuer = format!("http://{}/realms/keasy", listener.local_addr().unwrap());

    let jwks = serde_json::to_value(JwkSet { keys: vec![jwk] }).unwrap();
    let discovery = json!({ "issuer": issuer, "jwks_uri": format!("{issuer}/certs") });

    let hits = Arc::new(AtomicUsize::new(0));
    let (on_discovery, on_certs) = (hits.clone(), hits.clone());
    let app = Router::new()
        .route(
            "/realms/keasy/.well-known/openid-configuration",
            get(move || {
                on_discovery.fetch_add(1, Ordering::SeqCst);
                async move { Json(discovery) }
            }),
        )
        .route(
            "/realms/keasy/certs",
            get(move || {
                on_certs.fetch_add(1, Ordering::SeqCst);
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

pub fn mint(realm: &Realm, claims: serde_json::Value) -> String {
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(realm.kid.clone());
    encode(&header, &claims, &realm.key).unwrap()
}

fn in_an_hour() -> i64 {
    jiff::Timestamp::now().as_second() + 3600
}

/// Everything a good token carries, before a test spoils one field of it.
pub fn good(realm: &Realm) -> serde_json::Value {
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
