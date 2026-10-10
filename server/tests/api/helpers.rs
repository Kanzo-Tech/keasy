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
    ApplicationSettings, BrandingSettings, DatabaseSettings, OidcSettings, Rate, Settings,
};
use keasy_server::credentials::sealing::SecretKey;
use keasy_server::database::Database;
use keasy_server::domain::{
    Actor, ConnectionView, Direction, Provenance, ResourceName, SecretSpec, StorageTarget,
    ValidationReport,
};
use keasy_server::startup::Application;
use keasy_server::storage_client::Endpoints;

/// The server on a free port over a fresh database, verifying tokens against
/// a fake realm; `db` is a second handle on the same file.
pub struct TestApp {
    pub address: String,
    pub client: reqwest::Client,
    pub db: Database,
    pub realm: Realm,
    /// Where its S3 and STS answer: the deployment's, as `AWS_ENDPOINT_URL_S3` sets it.
    pub endpoints: Endpoints,
    _dir: tempfile::TempDir,
}

/// The organization the test instance serves, and the application's client.
pub const ORG: &str = "acme";
pub const CLIENT: &str = "keasy";

/// The roles a token carries for each role, as Keycloak expands the composites.
pub const READER: &[&str] = &["reader"];
pub const EDITOR: &[&str] = &["editor", "reader"];
pub const ADMIN: &[&str] = &["admin", "editor", "reader"];

pub fn secret_key() -> SecretKey {
    SecretKey::from_base64(&base64::engine::general_purpose::STANDARD.encode([42u8; 32])).unwrap()
}

/// The server with every default of [`Options`].
pub async fn spawn_app() -> TestApp {
    spawn_app_with(Options::default()).await
}

/// How a test's server differs from the default one; each field defaults on its own.
pub struct Options {
    /// Where its S3 and STS answer: [`DEAD`] unless said.
    pub store: String,
    /// Each caller's allowance: the build's.
    pub rate: Rate,
    /// Its declared look: none.
    pub branding: BrandingSettings,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            store: DEAD.into(),
            rate: Rate::BUILT,
            branding: BrandingSettings::default(),
        }
    }
}

/// The server as `options` describe it.
pub async fn spawn_app_with(options: Options) -> TestApp {
    let Options {
        store,
        rate,
        branding,
    } = options;
    let endpoints = Endpoints {
        s3: Some(store.clone()),
        sts: Some(store),
    };
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
            org_alias: ORG.into(),
            bootstrap_file: None,
            branding,
            endpoints: endpoints.clone(),
            rate,
        },
        database,
        oidc: OidcSettings {
            issuer_url: realm.issuer.clone(),
            client_id: CLIENT.into(),
            audience: "keasy-api".into(),
            internal_base_url: None,
        },
    };
    let application = Application::build(settings).await.unwrap();
    let address = format!("http://127.0.0.1:{}", application.port());
    tokio::spawn(application.run_until_stopped(std::future::pending()));

    TestApp {
        address,
        client: reqwest::Client::builder().build().unwrap(),
        db: Database::open(&db_path, secret_key()).unwrap(),
        realm,
        endpoints,
        _dir: dir,
    }
}

impl TestApp {
    /// A token for `u-1` carrying exactly `roles` on this workspace's client.
    /// `u-1`, holding `roles` in this instance's organization.
    pub fn token(&self, roles: &[&str]) -> String {
        self.token_for("u-1", roles)
    }

    pub fn token_for(&self, sub: &str, roles: &[&str]) -> String {
        self.token_in(sub, ORG, roles)
    }

    /// `sub`, holding `roles` here, with the profile claims `profile` (`name`,
    /// `preferred_username`) in place of a good token's.
    pub fn token_profiled(&self, sub: &str, roles: &[&str], profile: serde_json::Value) -> String {
        let mut claims = good(&self.realm);
        claims["sub"] = json!(sub);
        claims["organization"] = json!({ ORG: { "id": format!("{ORG}-id"), "resource_access": { CLIENT: { "roles": roles } } } });
        let claims = claims.as_object_mut().unwrap();
        claims.remove("name");
        claims.remove("preferred_username");
        claims.extend(profile.as_object().unwrap().clone());
        mint(&self.realm, json!(claims))
    }

    /// `sub`, holding `roles` here and in the groups `groups` (their ids, as
    /// the platform's Organization Group Ids mapper writes them).
    pub fn token_grouped(&self, sub: &str, roles: &[&str], groups: &[&str]) -> String {
        let mut claims = good(&self.realm);
        claims["sub"] = json!(sub);
        claims["organization"] = json!({ ORG: {
            "id": format!("{ORG}-id"),
            "groups": groups,
            "resource_access": { CLIENT: { "roles": roles } }
        } });
        mint(&self.realm, claims)
    }

    /// `sub`, holding `roles` in organization `org` only.
    pub fn token_in(&self, sub: &str, org: &str, roles: &[&str]) -> String {
        let mut claims = good(&self.realm);
        claims["sub"] = json!(sub);
        claims["organization"] = json!({ org: { "id": format!("{org}-id"), "resource_access": { CLIENT: { "roles": roles } } } });
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

    /// A graph to run on the sink `sink`: a draft, submitted with a folder of
    /// its own, idle. Its id.
    pub async fn submitted(&self, token: &str) -> String {
        static FOLDERS: AtomicUsize = AtomicUsize::new(0);
        let folder = format!("out-{}", FOLDERS.fetch_add(1, Ordering::Relaxed));
        let (status, draft) = self
            .send(
                Method::POST,
                "/v1/graphs",
                token,
                json!({ "script": "x", "sink_connection": "sink" }),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{draft}");
        let id = draft["id"].as_str().unwrap();
        let (status, graph) = self
            .send(
                Method::POST,
                &format!("/v1/graphs/{id}/submit"),
                token,
                json!({ "folder": folder }),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{graph}");
        id.to_string()
    }

    /// A graph submitted and run by `token`'s caller, who is its runner. Its id.
    pub async fn running(&self, token: &str) -> String {
        let id = self.submitted(token).await;
        let (status, graph) = self.run(token, &id).await;
        assert_eq!(status, StatusCode::OK, "{graph}");
        id
    }

    /// `POST /v1/graphs/{id}/run`: the status, and the graph or the refusal.
    pub async fn run(&self, token: &str, id: &str) -> (StatusCode, serde_json::Value) {
        self.send(
            Method::POST,
            &format!("/v1/graphs/{id}/run"),
            token,
            json!(null),
        )
        .await
    }

    /// What the runner reports of graph `id`: `POST /v1/graphs/{id}/status`. The
    /// status, and the graph as the report left it — read back, since a report
    /// answers only whether to stop — or the refusal's body.
    pub async fn report(
        &self,
        token: &str,
        id: &str,
        report: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let (status, body) = self
            .send(
                Method::POST,
                &format!("/v1/graphs/{id}/status"),
                token,
                report,
            )
            .await;
        if status != StatusCode::OK {
            return (status, body);
        }
        let (_, graph) = self
            .send(Method::GET, &format!("/v1/graphs/{id}"), token, json!(null))
            .await;
        (status, graph)
    }

    /// What fossil's host asks the one vend door: `scope`, for `access`. The
    /// status, and the refusal's code when there is one.
    pub async fn vend(
        &self,
        token: &str,
        scope: serde_json::Value,
        access: &str,
    ) -> (StatusCode, Option<String>) {
        let (status, body) = self
            .send(
                Method::POST,
                "/v1/storage-credentials",
                token,
                json!({ "scope": scope, "access": access }),
            )
            .await;
        (status, body["code"].as_str().map(str::to_owned))
    }

    /// A stored S3 credential, unprobed, created by `by`.
    pub async fn credential(&self, name: &str, by: &str) {
        keasy_server::credentials::persistence::insert(
            &*self.db.write().await,
            self.db.secret_key(),
            &ResourceName::parse(name).unwrap(),
            &s3("original-secret"),
            &actor(by),
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
            secret: credential.into(),
            target,
            owner: actor(by).as_owner(),
            grants: vec![],
            provenance: Provenance::created(actor(by)),
            validation: None,
            can: Default::default(),
        };
        keasy_server::connections::persistence::insert(&*self.db.write().await, &view, &actor(by))
            .unwrap();
    }
}

/// `sub` as a stored row records them, named after their id.
fn actor(sub: &str) -> Actor {
    Actor {
        id: sub.into(),
        name: sub.into(),
    }
}

pub fn unprobed() -> ValidationReport {
    ValidationReport {
        at: "now".into(),
        results: Vec::new(),
        by: None,
    }
}

pub fn s3(secret: &str) -> SecretSpec {
    SecretSpec::S3 {
        access_key_id: "AK".into(),
        secret_access_key: SecretString::from(secret),
        region: "us-east-1".into(),
        role_arn: None,
        external_id: None,
    }
}

/// Nothing listens here: a probe through it fails at once.
pub const DEAD: &str = "http://127.0.0.1:1";

/// A store that answers as S3 does, enough for LIST, PUT and DELETE: every
/// bucket is empty and every write lands — for the access key `AK`. Any other
/// key is refused, as S3 refuses a key it does not know.
pub async fn fake_s3() -> String {
    async fn answer(method: Method, headers: HeaderMap) -> axum::response::Response {
        let signed_by_ak = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.contains("Credential=AK/"));
        if !signed_by_ak {
            return StatusCode::FORBIDDEN.into_response();
        }
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
        "aud": ["keasy-api", "account"],
        "azp": CLIENT,
        "exp": in_an_hour(),
        "email": "dev@keasy.local",
        "name": "Dev User",
        "preferred_username": "dev",
        "organization": {
            ORG: { "id": "acme-id", "resource_access": { CLIENT: { "roles": ADMIN } } },
            "globex": { "id": "globex-id", "resource_access": { CLIENT: { "roles": READER } } },
        },
    })
}
