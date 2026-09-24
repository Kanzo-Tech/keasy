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
        let mut request = Request::builder().method(method).uri(path);
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let mut request = request.body(Body::empty()).unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 1))));
        self.app.clone().oneshot(request).await.unwrap().status()
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
