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
use crate::{AppState, Database};

/// The real router over a real database and catalog, verifying tokens against a
/// fake realm.
struct Harness {
    app: Router,
    realm: Realm,
    _dir: tempfile::TempDir,
}

impl Harness {
    async fn new() -> Self {
        let realm = realm("k1").await;
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("keasy.db"), None).unwrap();
        let catalog = crate::catalog::Catalog::open(dir.path()).unwrap();
        let state = AppState {
            db,
            workspace_slug: Some("dev".into()),
            auth: Arc::new(Validator::new(
                &realm.issuer,
                "keasy-api",
                "keasy-ws-dev",
                None,
            )),
            catalog: Some(Arc::new(catalog)),
        };
        Self {
            app: super::build_router(state, None),
            realm,
            _dir: dir,
        }
    }

    /// A token for `u-1` carrying exactly `roles` on this workspace's client.
    fn token(&self, roles: &[&str]) -> String {
        let mut claims = good(&self.realm);
        claims["resource_access"] = json!({ "keasy-ws-dev": { "roles": roles } });
        mint(&self.realm, claims)
    }

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

/// The request log used to run outside the bearer layer and so always wrote
/// `user_id = "-"`. The line that closes a request names who made it.
#[tokio::test]
async fn the_request_log_names_the_authenticated_caller() {
    let logs = Captured::default();
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_max_level(tracing::Level::INFO)
        .with_writer(logs.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    let harness = Harness::new().await;
    let token = harness.token(&["member"]);
    assert_eq!(
        harness.call(Method::GET, "/v1/jobs", Some(&token)).await,
        StatusCode::OK
    );

    let out = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    let line = out
        .lines()
        .find(|l| l.contains("finished processing request") && l.contains("/v1/jobs"))
        .unwrap_or_else(|| panic!("no response line in:\n{out}"));
    assert!(line.contains(r#""user_id":"u-1""#), "{line}");
}
