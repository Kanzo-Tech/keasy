use std::io;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use serde_json::json;
use tower::ServiceExt;
use tracing_subscriber::fmt::MakeWriter;

use crate::api::connections::{ConnectionTarget, ConnectionView, Direction, StorageTarget};
use crate::api::credentials::{CredentialSpecInput, StorageCredentialInput};
use crate::api::validation::ValidationReport;
use crate::authentication::token::Validator;
use crate::authentication::token::tests::{Realm, good, mint, realm};
use crate::{AppState, Database};
use secrecy::SecretString;

use crate::domain::ResourceName;

/// The real router over a real database, verifying tokens against a
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
            crate::credentials::sealing::SecretKey::for_tests(),
        )
        .unwrap();
        let state = AppState {
            db: db.clone(),
            workspace_slug: Some("dev".into()),
            workspace_name: "Dev".into(),
            auth: Arc::new(Validator::new(
                &realm.issuer,
                "keasy-api",
                "keasy-ws-dev",
                None,
            )),
        };
        Self {
            app: super::build_router(state),
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

    /// A JSON request; the status and the body.
    async fn send(
        &self,
        method: Method,
        path: &str,
        token: &str,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or_default())
    }

    /// A stored S3 credential on `endpoint`, unprobed, created by `by`.
    async fn credential(&self, name: &str, endpoint: &str, by: &str) {
        crate::credentials::persistence::insert(
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
    async fn connection(&self, name: &str, credential: &str, direction: Direction, by: &str) {
        let target = ConnectionTarget::Storage(StorageTarget {
            url: format!("s3://b/{name}/"),
            kind: Default::default(),
            direction,
        });
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
        crate::connections::persistence::insert(&*self.db.write().await, &view, by).unwrap();
    }
}

fn unprobed() -> ValidationReport {
    ValidationReport {
        at: "now".into(),
        results: Vec::new(),
    }
}

fn s3(endpoint: &str, secret: &str) -> CredentialSpecInput {
    CredentialSpecInput::Storage(StorageCredentialInput::S3 {
        access_key_id: "AK".into(),
        secret_access_key: SecretString::from(secret),
        region: "us-east-1".into(),
        endpoint: Some(endpoint.into()),
    })
}

/// Nothing listens here: a probe through it fails at once.
const DEAD: &str = "http://127.0.0.1:1";

/// A store that answers as S3 does, enough for LIST, PUT and DELETE: every
/// bucket is empty and every write lands.
async fn fake_s3() -> String {
    use axum::http::HeaderMap;
    use axum::response::IntoResponse;
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

/// A job needs a destination, and it must be the sink.
#[tokio::test]
async fn a_job_goes_to_the_sink_or_is_refused() {
    let harness = Harness::new().await;
    let member = harness.token(&["member"]);
    harness.credential("key", DEAD, "u-1").await;
    harness
        .connection("source", "key", Direction::Source, "u-1")
        .await;
    harness
        .connection("sink", "key", Direction::Sink, "u-1")
        .await;

    let create = |sink: Option<&str>| {
        let mut body = json!({ "script": "x", "draft": true });
        if let Some(sink) = sink {
            body["sink_connection"] = json!(sink);
        }
        harness.send(Method::POST, "/v1/jobs", &member, body)
    };

    assert_eq!(create(None).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, body) = create(Some("source")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_destination");
    assert_eq!(create(Some("gone")).await.0, StatusCode::BAD_REQUEST);
    let (status, job) = create(Some("sink")).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(job["sink_connection"], json!("sink"));
}

/// A job is its creator's: another member neither lists, reads, edits, runs,
/// signs nor deletes it — to them it does not exist.
#[tokio::test]
async fn a_job_is_its_creators_alone() {
    let harness = Harness::new().await;
    let mine = harness.token_for("u-1", &["member"]);
    let theirs = harness.token_for("u-2", &["member"]);
    harness.credential("key", DEAD, "u-1").await;
    harness
        .connection("sink", "key", Direction::Sink, "u-1")
        .await;

    let (_, job) = harness
        .send(
            Method::POST,
            "/v1/jobs",
            &mine,
            json!({ "script": "x", "draft": true, "sink_connection": "sink" }),
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

/// A secret goes in and never comes out: not in a create's answer, not in a
/// listing, not in a read, and no response schema has a field to carry one.
#[tokio::test]
async fn no_response_carries_a_secret() {
    let harness = Harness::new().await;
    let member = harness.token(&["member"]);
    let (status, created) = harness
        .send(
            Method::POST,
            "/v1/credentials",
            &member,
            json!({ "name": "minio", "spec": { "storage": {
                "kind": "s3", "access_key_id": "AK", "secret_access_key": "top-secret"
            }}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["spec"]["storage"]["region"], "us-east-1");
    for (_, body) in [
        (status, created),
        harness
            .send(Method::GET, "/v1/credentials", &member, json!(null))
            .await,
        harness
            .send(Method::GET, "/v1/credentials/minio", &member, json!(null))
            .await,
    ] {
        assert!(!body.to_string().contains("top-secret"), "{body}");
        assert!(!body.to_string().contains("secret_access_key"), "{body}");
    }

    let spec = serde_json::to_value(crate::openapi()).unwrap();
    for view in [
        "StorageCredentialView",
        "ModelCredentialView",
        "CredentialView",
        "ConnectionView",
    ] {
        let schema = spec["components"]["schemas"][view].to_string();
        for secret in [
            "writeOnly",
            "password",
            "secret",
            "api_key",
            "sas_token",
            "\"key\"",
        ] {
            assert!(
                !schema.contains(secret),
                "{view} mentions {secret}: {schema}"
            );
        }
    }
}

/// The credential a connection uses cannot be deleted, nor the sink a job wrote
/// to; the refusal names what is in the way.
#[tokio::test]
async fn what_is_in_use_is_not_deleted() {
    let harness = Harness::new().await;
    let member = harness.token(&["member"]);
    let owner = harness.token_for("u-owner", &["owner"]);
    harness.credential("key", DEAD, "u-1").await;
    harness
        .connection("data", "key", Direction::Source, "u-1")
        .await;
    harness
        .connection("sink", "key", Direction::Sink, "u-1")
        .await;

    let (status, body) = harness
        .send(Method::DELETE, "/v1/credentials/key", &member, json!(null))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "in_use");
    assert_eq!(body["dependents"], json!(["data", "sink"]));

    let (_, job) = harness
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "draft": true, "sink_connection": "sink" }),
        )
        .await;
    let (status, body) = harness
        .send(Method::DELETE, "/v1/connections/sink", &owner, json!(null))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["dependents"], json!([job["id"]]));

    assert_eq!(
        harness
            .send(Method::DELETE, "/v1/connections/data", &member, json!(null))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
}

/// A credential or connection is its creator's or the owner's to change; the
/// sink is the owner's alone, and sources and models are the members'.
#[tokio::test]
async fn only_the_creator_or_the_owner_changes_a_credential_and_only_the_owner_the_sink() {
    let harness = Harness::new().await;
    let creator = harness.token_for("u-1", &["member"]);
    let other = harness.token_for("u-2", &["member"]);
    let owner = harness.token_for("u-owner", &["owner"]);
    harness.credential("key", DEAD, "u-1").await;
    harness.credential("spare", DEAD, "u-1").await;
    harness
        .connection("data", "key", Direction::Source, "u-1")
        .await;
    harness
        .connection("sink", "key", Direction::Sink, "u-1")
        .await;

    let rename = json!({ "name": "renamed" });
    let refused = harness
        .send(Method::PATCH, "/v1/credentials/key", &other, rename.clone())
        .await;
    assert_eq!(
        (refused.0, refused.1["error"].clone()),
        (StatusCode::FORBIDDEN, json!("forbidden"))
    );
    assert_eq!(
        harness
            .send(Method::DELETE, "/v1/credentials/spare", &other, json!(null))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        harness
            .send(Method::DELETE, "/v1/connections/data", &other, json!(null))
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    let (status, renamed) = harness
        .send(Method::PATCH, "/v1/credentials/key", &creator, rename)
        .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(
        renamed["used_by"],
        json!(["data", "sink"]),
        "the rename cascades"
    );
    assert_eq!(
        harness
            .send(Method::DELETE, "/v1/credentials/spare", &owner, json!(null))
            .await
            .0,
        StatusCode::NO_CONTENT
    );

    let sink = json!({ "name": "sink2", "credential": "renamed", "target": { "storage": {
        "url": "s3://b/out2/", "direction": "sink" } } });
    let source = json!({ "name": "more", "credential": "renamed", "target": { "storage": {
        "url": "s3://b/more/" } } });
    assert_eq!(
        harness
            .send(Method::POST, "/v1/connections", &creator, sink)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        harness
            .send(Method::POST, "/v1/connections", &owner, source)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        harness
            .send(
                Method::DELETE,
                "/v1/connections/sink",
                &creator,
                json!(null)
            )
            .await
            .0,
        StatusCode::FORBIDDEN,
        "not even its creator: the sink is the owner's"
    );
    let to_sink =
        json!({ "target": { "storage": { "url": "s3://b/data/", "direction": "sink" } } });
    assert_eq!(
        harness
            .send(Method::PATCH, "/v1/connections/data", &creator, to_sink)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
}

/// A storage connection cannot sign with a model key: refused before any probe.
#[tokio::test]
async fn a_connection_names_a_credential_of_its_own_purpose() {
    let harness = Harness::new().await;
    let member = harness.token(&["member"]);
    let model =
        CredentialSpecInput::Model(crate::api::credentials::ModelCredentialInput::Anthropic {
            api_key: SecretString::from("sk"),
        });
    crate::credentials::persistence::insert(
        &*harness.db.write().await,
        harness.db.secret_key(),
        &ResourceName::parse("claude").unwrap(),
        &model,
        "u-1",
        &unprobed(),
    )
    .unwrap();
    let (status, body) = harness
        .send(
            Method::POST,
            "/v1/connections",
            &member,
            json!({ "name": "b", "credential": "claude", "target": { "storage": { "url": "s3://b/" } } }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("model credential"),
        "{body}"
    );
}

/// Everything through the API against a store that answers: a credential
/// probed at a URL, a source LISTed, the sink written and deleted, a rotation
/// every dependent accepts — and one they do not, which changes nothing.
#[tokio::test]
async fn a_rotation_is_committed_only_if_every_dependent_still_validates() {
    let harness = Harness::new().await;
    let member = harness.token(&["member"]);
    let owner = harness.token_for("u-owner", &["owner"]);
    let s3 = fake_s3().await;
    let spec = |endpoint: &str, secret: &str| {
        json!({ "storage": {
            "kind": "s3", "access_key_id": "AK", "secret_access_key": secret, "endpoint": endpoint
        }})
    };

    let (status, body) = harness
        .send(
            Method::POST,
            "/v1/credentials",
            &member,
            json!({ "name": "minio", "spec": spec(DEAD, "s"), "probe_url": "s3://b/" }),
        )
        .await;
    assert_eq!(
        (status, body["error"].clone()),
        (StatusCode::UNPROCESSABLE_ENTITY, json!("probe_failed")),
        "{body}"
    );

    let (status, body) = harness
        .send(
            Method::POST,
            "/v1/credentials",
            &member,
            json!({ "name": "minio", "spec": spec(&s3, "first"), "probe_url": "s3://b/" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["validation"]["results"][0]["result"], "pass");

    let (status, body) = harness
        .send(
            Method::POST,
            "/v1/connections",
            &member,
            json!({ "name": "data", "credential": "minio",
            "target": { "storage": { "url": "s3://b/data/" } } }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (status, body) = harness
        .send(
            Method::POST,
            "/v1/connections",
            &owner,
            json!({ "name": "out", "credential": "minio",
            "target": { "storage": { "url": "s3://b/out/", "direction": "sink" } } }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let ops: Vec<_> = body["validation"]["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["operation"].clone(), c["result"].clone()))
        .collect();
    assert_eq!(
        ops,
        [
            (json!("write"), json!("pass")),
            (json!("delete"), json!("pass"))
        ]
    );

    let (status, body) = harness
        .send(
            Method::PATCH,
            "/v1/credentials/minio",
            &member,
            json!({ "spec": spec(DEAD, "second") }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["dependents"], json!(["data", "out"]));
    let kept = crate::credentials::named(&harness.db, "minio")
        .await
        .unwrap();
    assert!(
        matches!(&kept.spec, CredentialSpecInput::Storage(StorageCredentialInput::S3 { endpoint, .. })
        if endpoint.as_deref() == Some(s3.as_str())),
        "the old spec stands"
    );

    let (status, body) = harness
        .send(
            Method::PATCH,
            "/v1/credentials/minio",
            &member,
            json!({ "spec": spec(&s3, "second") }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rotated = crate::credentials::named(&harness.db, "minio")
        .await
        .unwrap();
    assert!(
        matches!(&rotated.spec, CredentialSpecInput::Storage(StorageCredentialInput::S3 { secret_access_key, .. })
        if secrecy::ExposeSecret::expose_secret(secret_access_key) == "second")
    );

    let (status, report) = harness
        .send(
            Method::POST,
            "/v1/connections/data/validate",
            &member,
            json!(null),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(report["results"][0]["operation"], "list");
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
        let request = request.body(Body::empty()).unwrap();
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
    ("POST", "/v1/jobs/x/discover/urls", Admits::Member),
    ("POST", "/v1/ai/stream", Admits::Member),
    ("GET", "/v1/credentials", Admits::AnyRole),
    ("POST", "/v1/credentials", Admits::Member),
    ("GET", "/v1/credentials/x", Admits::AnyRole),
    ("PATCH", "/v1/credentials/x", Admits::AnyRole),
    ("DELETE", "/v1/credentials/x", Admits::AnyRole),
    ("POST", "/v1/credentials/x/validate", Admits::AnyRole),
    ("GET", "/v1/connections", Admits::AnyRole),
    ("POST", "/v1/connections", Admits::AnyRole),
    ("GET", "/v1/connections/x", Admits::AnyRole),
    ("PATCH", "/v1/connections/x", Admits::AnyRole),
    ("DELETE", "/v1/connections/x", Admits::AnyRole),
    ("POST", "/v1/connections/x/validate", Admits::AnyRole),
    ("GET", "/v1/connections/x/files", Admits::Member),
    ("POST", "/v1/connections/urls", Admits::Member),
    ("GET", "/v1/datasets", Admits::Owner),
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
        "/v1/jobs/x/discover/urls",
        "/v1/ai/stream",
        "/v1/credentials",
        "/v1/credentials/x",
        "/v1/credentials/x/validate",
        "/v1/connections",
        "/v1/connections/x",
        "/v1/connections/x/validate",
        "/v1/connections/x/files",
        "/v1/connections/urls",
        "/v1/datasets",
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
