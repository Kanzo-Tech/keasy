use std::io;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode, header};
use serde_json::json;
use tower::ServiceExt;
use tracing_subscriber::fmt::MakeWriter;

use crate::auth::jwt::Validator;
use crate::auth::jwt::tests::{Realm, good, mint, realm};
use crate::connections::models::{
    ConnectionKind, CreateConnectionRequest, Direction, LocationType,
};
use crate::{AppState, Database};

/// The real router over a real database and catalog, verifying tokens against a
/// fake realm.
struct Harness {
    app: Router,
    db: Database,
    realm: Realm,
    _dir: tempfile::TempDir,
}

impl Harness {
    async fn new() -> Self {
        let realm = realm("k1").await;
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(
            &dir.path().join("keasy.db"),
            crate::crypto::SecretKey::for_tests(),
        )
        .unwrap();
        let catalog = crate::catalog::Catalog::open(dir.path()).unwrap();
        let state = AppState {
            db: db.clone(),
            workspace_slug: Some("dev".into()),
            auth: Arc::new(Validator::new(
                &realm.issuer,
                "keasy-api",
                "keasy-ws-dev",
                None,
            )),
            catalog: Arc::new(catalog),
        };
        Self {
            app: super::build_router(state, None),
            db,
            realm,
            _dir: dir,
        }
    }

    /// A token for `u-1` carrying exactly `roles` on this workspace's client.
    fn token(&self, roles: &[&str]) -> String {
        self.token_for("u-1", roles)
    }

    fn token_for(&self, sub: &str, roles: &[&str]) -> String {
        let mut claims = good(&self.realm);
        claims["sub"] = json!(sub);
        claims["resource_access"] = json!({ "keasy-ws-dev": { "roles": roles } });
        mint(&self.realm, claims)
    }

    /// A JSON request; the status and the unwrapped `data` (or the error body).
    async fn send(
        &self,
        method: Method,
        path: &str,
        token: &str,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 1))));
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        let data = json.get("data").cloned().unwrap_or(json);
        (status, data)
    }

    async fn connection(&self, name: &str, direction: Direction) -> String {
        self.db
            .create_connection(CreateConnectionRequest {
                name: name.into(),
                kind: ConnectionKind::Data,
                location_type: LocationType::Local,
                direction,
                cloud_account_id: None,
                url: format!("/tmp/{name}"),
            })
            .await
            .unwrap()
            .id
    }
}

/// A job needs a destination, and it must be the sink.
#[tokio::test]
async fn a_job_goes_to_the_sink_or_is_refused() {
    let harness = Harness::new().await;
    let member = harness.token(&["member"]);
    let source = harness.connection("source", Direction::Source).await;
    let sink = harness.connection("sink", Direction::Sink).await;

    let create = |sink: Option<&str>| {
        let mut body = json!({ "script": "x", "draft": true });
        if let Some(sink) = sink {
            body["sink_connection_id"] = json!(sink);
        }
        harness.send(Method::POST, "/v1/jobs", &member, body)
    };

    assert_eq!(create(None).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, body) = create(Some(&source)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_destination");
    assert_eq!(create(Some("gone")).await.0, StatusCode::BAD_REQUEST);
    let (status, job) = create(Some(&sink)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(job["sink_connection_id"], json!(sink));
}

/// A job is its creator's: another member neither lists, reads, edits, runs,
/// signs nor deletes it — to them it does not exist.
#[tokio::test]
async fn a_job_is_its_creators_alone() {
    let harness = Harness::new().await;
    let mine = harness.token_for("u-1", &["member"]);
    let theirs = harness.token_for("u-2", &["member"]);
    let sink = harness.connection("sink", Direction::Sink).await;

    let (_, job) = harness
        .send(
            Method::POST,
            "/v1/jobs",
            &mine,
            json!({ "script": "x", "draft": true, "sink_connection_id": sink }),
        )
        .await;
    let id = job["id"].as_str().unwrap().to_string();
    let path = format!("/v1/jobs/{id}");

    let (_, listed) = harness
        .send(Method::GET, "/v1/jobs", &theirs, json!(null))
        .await;
    assert_eq!(listed, json!([]));
    let (_, listed) = harness
        .send(Method::GET, "/v1/jobs", &mine, json!(null))
        .await;
    assert_eq!(listed.as_array().unwrap().len(), 1);

    for (verb, route, body) in [
        (Method::GET, path.clone(), json!(null)),
        (Method::PUT, path.clone(), json!({ "name": "stolen" })),
        (Method::PATCH, path.clone(), json!({ "status": "running" })),
        (Method::DELETE, path.clone(), json!(null)),
        (Method::GET, format!("{path}/source-refs"), json!(null)),
        (
            Method::POST,
            format!("{path}/output/urls"),
            json!({ "paths": ["a.parquet"] }),
        ),
        (
            Method::POST,
            format!("{path}/discover/urls"),
            json!({ "paths": ["a.parquet"] }),
        ),
        (
            Method::POST,
            format!("{path}/sources/urls"),
            json!({ "uris": [] }),
        ),
        (
            Method::PUT,
            format!("{path}/relations"),
            json!({ "relations": [] }),
        ),
    ] {
        let (status, _) = harness.send(verb.clone(), &route, &theirs, body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{verb} {route}");
    }

    let (status, job) = harness.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(job["id"], json!(id));
}

impl Harness {
    async fn call(&self, method: Method, path: &str, token: Option<&str>) -> StatusCode {
        self.answer(method, path, token).await.0
    }

    /// Status and the `error` code of the body, when there is one.
    async fn answer(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
    ) -> (StatusCode, Option<String>) {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let mut request = request.body(Body::empty()).unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 1))));
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let code = serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v["error"].as_str().map(str::to_owned));
        (status, code)
    }
}

/// Who a route admits.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Admits {
    Owner,
    Member,
    AnyRole,
}

/// Every role-gated route. A route added without a row here fails
/// `every_role_gated_route_is_in_the_table`.
const ROUTES: &[(&str, &str, Admits)] = &[
    ("GET", "/v1/jobs", Admits::Member),
    ("POST", "/v1/jobs", Admits::Member),
    ("GET", "/v1/jobs/x", Admits::Member),
    ("PUT", "/v1/jobs/x", Admits::Member),
    ("PATCH", "/v1/jobs/x", Admits::Member),
    ("DELETE", "/v1/jobs/x", Admits::Member),
    ("PUT", "/v1/jobs/x/relations", Admits::Member),
    ("POST", "/v1/jobs/x/output/urls", Admits::Member),
    ("GET", "/v1/jobs/x/source-refs", Admits::Member),
    ("POST", "/v1/jobs/x/sources/urls", Admits::Member),
    ("POST", "/v1/jobs/x/discover/urls", Admits::Member),
    ("POST", "/v1/jobs/x/discover/ask-stream", Admits::Member),
    ("GET", "/v1/settings/ai/providers", Admits::Member),
    ("PUT", "/v1/settings/ai/providers/x", Admits::Member),
    ("DELETE", "/v1/settings/ai/providers/x", Admits::Member),
    ("POST", "/v1/cloud-accounts", Admits::Member),
    ("GET", "/v1/cloud-accounts/x", Admits::Member),
    ("PUT", "/v1/cloud-accounts/x", Admits::Member),
    ("DELETE", "/v1/cloud-accounts/x", Admits::Member),
    ("GET", "/v1/connections", Admits::Member),
    ("POST", "/v1/connections", Admits::Member),
    ("GET", "/v1/connections/x", Admits::Member),
    ("DELETE", "/v1/connections/x", Admits::Member),
    ("GET", "/v1/connections/x/files", Admits::Member),
    ("POST", "/v1/connections/x/urls", Admits::Member),
    ("POST", "/v1/assistant/suggest-stream", Admits::Member),
    ("POST", "/v1/assistant/generate-stream", Admits::Member),
    ("GET", "/v1/settings/organization", Admits::Owner),
    ("PUT", "/v1/settings/organization", Admits::Owner),
    ("GET", "/v1/settings/catalog-storage", Admits::Owner),
    ("PUT", "/v1/settings/catalog-storage", Admits::Owner),
    ("GET", "/v1/catalog/datasets", Admits::Owner),
    ("PUT", "/v1/org/identity", Admits::Owner),
    ("GET", "/v1/cloud-accounts", Admits::AnyRole),
    ("GET", "/v1/org/identity", Admits::AnyRole),
];

fn method(name: &str) -> Method {
    Method::from_bytes(name.as_bytes()).unwrap()
}

/// The authorization contract, route by route: each role is admitted exactly
/// where the table says, refused with `rbac/insufficient_role` everywhere else,
/// a token with no workspace role gets `rbac/no_membership`, and no token 401.
#[tokio::test]
async fn every_route_admits_exactly_its_roles() {
    let harness = Harness::new().await;
    let owner = harness.token(&["owner"]);
    let member = harness.token(&["member"]);
    let nobody = harness.token(&[]);

    for &(verb, path, admits) in ROUTES {
        for (role, token) in [(Admits::Owner, &owner), (Admits::Member, &member)] {
            let admitted = admits == Admits::AnyRole || admits == role;
            let (status, code) = harness.answer(method(verb), path, Some(token)).await;
            if admitted {
                assert!(
                    status != StatusCode::FORBIDDEN && status != StatusCode::UNAUTHORIZED,
                    "{verb} {path} must admit {role:?}, got {status} {code:?}"
                );
            } else {
                assert_eq!(
                    (status, code.as_deref()),
                    (StatusCode::FORBIDDEN, Some("rbac/insufficient_role")),
                    "{verb} {path} must refuse {role:?}"
                );
            }
        }
        assert_eq!(
            harness.answer(method(verb), path, Some(&nobody)).await,
            (
                StatusCode::FORBIDDEN,
                Some("rbac/no_membership".to_string())
            ),
            "{verb} {path} without a workspace role"
        );
        assert_eq!(
            harness.call(method(verb), path, None).await,
            StatusCode::UNAUTHORIZED,
            "{verb} {path} without a token"
        );
    }
}

/// The table is the whole of the gated surface: every route under the role
/// layer appears in it, and nothing else does.
#[tokio::test]
async fn every_role_gated_route_is_in_the_table() {
    let harness = Harness::new().await;
    let nobody = harness.token(&[]);
    let member = harness.token(&["member"]);
    let candidates = [
        "/v1/jobs",
        "/v1/jobs/x",
        "/v1/jobs/x/relations",
        "/v1/jobs/x/output/urls",
        "/v1/jobs/x/source-refs",
        "/v1/jobs/x/sources/urls",
        "/v1/jobs/x/discover/urls",
        "/v1/jobs/x/discover/ask-stream",
        "/v1/settings/ai/providers",
        "/v1/settings/ai/providers/x",
        "/v1/cloud-accounts",
        "/v1/cloud-accounts/x",
        "/v1/connections",
        "/v1/connections/x",
        "/v1/connections/x/files",
        "/v1/connections/x/urls",
        "/v1/assistant/suggest-stream",
        "/v1/assistant/generate-stream",
        "/v1/settings/organization",
        "/v1/settings/catalog-storage",
        "/v1/catalog/datasets",
        "/v1/org/identity",
        "/v1/settings/schema",
        "/v1/auth/workspaces",
    ];
    for path in candidates {
        for verb in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
            let listed = ROUTES.iter().any(|&(v, p, _)| v == verb && p == path);
            let exists = harness.call(method(verb), path, Some(&member)).await
                != StatusCode::METHOD_NOT_ALLOWED;
            let (_, code) = harness.answer(method(verb), path, Some(&nobody)).await;
            let gated = exists && code.as_deref() == Some("rbac/no_membership");
            assert_eq!(gated, listed, "{verb} {path}");
        }
    }
}

#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl io::Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for Captured {
    type Writer = Captured;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

/// The process-wide subscriber, installed once. A thread-local one races the
/// other tests: a callsite first reached on another thread caches "disabled".
fn captured_logs() -> Captured {
    static LOGS: std::sync::OnceLock<Captured> = std::sync::OnceLock::new();
    LOGS.get_or_init(|| {
        let logs = Captured::default();
        tracing::subscriber::set_global_default(
            tracing_subscriber::fmt()
                .json()
                .with_max_level(tracing::Level::INFO)
                .with_writer(logs.clone())
                .finish(),
        )
        .expect("the only global subscriber in the test binary");
        logs
    })
    .clone()
}

/// The request log used to run outside the bearer layer and so always wrote
/// `user_id = "-"`. The line that closes a request names who made it.
#[tokio::test]
async fn the_request_log_names_the_authenticated_caller() {
    let logs = captured_logs();
    let harness = Harness::new().await;
    let token = harness.token_for("u-logged", &["member"]);
    assert_eq!(
        harness.call(Method::GET, "/v1/jobs", Some(&token)).await,
        StatusCode::OK
    );

    let out = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(
        out.lines()
            .any(|l| l.contains("finished processing request")
                && l.contains("/v1/jobs")
                && l.contains(r#""user_id":"u-logged""#)),
        "no response line naming the caller in:\n{out}"
    );
}
