use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{DEAD, fake_s3, spawn_app};
use keasy_server::domain::{Direction, StorageCredentialInput};

/// A secret goes in and never comes out: not in a create's answer, not in a
/// listing, not in a read, and no response schema has a field to carry one.
#[tokio::test]
async fn no_response_carries_a_secret() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    let (status, created) = app
        .send(
            Method::POST,
            "/v1/credentials",
            &member,
            json!({ "name": "minio", "spec": {
                "kind": "s3", "access_key_id": "AK", "secret_access_key": "top-secret"
            }}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["spec"]["region"], "us-east-1");
    for (_, body) in [
        (status, created),
        app.send(Method::GET, "/v1/credentials", &member, json!(null))
            .await,
        app.send(Method::GET, "/v1/credentials/minio", &member, json!(null))
            .await,
    ] {
        assert!(!body.to_string().contains("top-secret"), "{body}");
        assert!(!body.to_string().contains("secret_access_key"), "{body}");
    }

    let spec = serde_json::to_value(keasy_server::startup::openapi()).unwrap();
    for view in ["StorageCredentialView", "CredentialView", "ConnectionView"] {
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

/// A credential or connection is its creator's or the owner's to change; the
/// sink is the owner's alone, and sources and models are the members'.
#[tokio::test]
async fn only_the_creator_or_the_owner_changes_a_credential_and_only_the_owner_the_sink() {
    let app = spawn_app().await;
    let creator = app.token_for("u-1", &["member"]);
    let other = app.token_for("u-2", &["member"]);
    let owner = app.token_for("u-owner", &["owner"]);
    app.credential("key", DEAD, "u-1").await;
    app.credential("spare", DEAD, "u-1").await;
    app.connection("data", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let rename = json!({ "name": "renamed" });
    let refused = app
        .send(Method::PATCH, "/v1/credentials/key", &other, rename.clone())
        .await;
    assert_eq!(
        (refused.0, refused.1["code"].clone()),
        (StatusCode::FORBIDDEN, json!("rbac/forbidden"))
    );
    assert_eq!(
        app.send(Method::DELETE, "/v1/credentials/spare", &other, json!(null))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.send(Method::DELETE, "/v1/connections/data", &other, json!(null))
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    let (status, renamed) = app
        .send(Method::PATCH, "/v1/credentials/key", &creator, rename)
        .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(
        renamed["used_by"],
        json!(["data", "sink"]),
        "the rename cascades"
    );
    assert_eq!(
        app.send(Method::DELETE, "/v1/credentials/spare", &owner, json!(null))
            .await
            .0,
        StatusCode::NO_CONTENT
    );

    let sink = json!({ "name": "sink2", "credential": "renamed", "target": {
        "url": "s3://b/out2/", "direction": "sink" } });
    let source = json!({ "name": "more", "credential": "renamed", "target": {
        "url": "s3://b/more/" } });
    assert_eq!(
        app.send(Method::POST, "/v1/connections", &creator, sink)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.send(Method::POST, "/v1/connections", &owner, source)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.send(
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
    let to_sink = json!({ "target": { "url": "s3://b/data/", "direction": "sink" } });
    assert_eq!(
        app.send(Method::PATCH, "/v1/connections/data", &creator, to_sink)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
}

/// Everything through the API against a store that answers: a credential
/// probed at a URL, a source LISTed, the sink written and deleted, a rotation
/// every dependent accepts — and one they do not, which changes nothing.
#[tokio::test]
async fn a_rotation_is_committed_only_if_every_dependent_still_validates() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    let owner = app.token_for("u-owner", &["owner"]);
    let s3 = fake_s3().await;
    let spec = |endpoint: &str, secret: &str| {
        json!({
            "kind": "s3", "access_key_id": "AK", "secret_access_key": secret, "endpoint": endpoint
        })
    };

    let (status, body) = app
        .send(
            Method::POST,
            "/v1/credentials",
            &member,
            json!({ "name": "minio", "spec": spec(DEAD, "s"), "probe_url": "s3://b/" }),
        )
        .await;
    assert_eq!(
        (status, body["code"].clone()),
        (StatusCode::UNPROCESSABLE_ENTITY, json!("probe/failed")),
        "{body}"
    );

    let (status, body) = app
        .send(
            Method::POST,
            "/v1/credentials",
            &member,
            json!({ "name": "minio", "spec": spec(&s3, "first"), "probe_url": "s3://b/" }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["validation"]["results"][0]["result"], "pass");

    let (status, body) = app
        .send(
            Method::POST,
            "/v1/connections",
            &member,
            json!({ "name": "data", "credential": "minio",
            "target": { "url": "s3://b/data/" } }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (status, body) = app
        .send(
            Method::POST,
            "/v1/connections",
            &owner,
            json!({ "name": "out", "credential": "minio",
            "target": { "url": "s3://b/out/", "direction": "sink" } }),
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

    let (status, body) = app
        .send(
            Method::PATCH,
            "/v1/credentials/minio",
            &member,
            json!({ "spec": spec(DEAD, "second") }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["data"]["dependents"], json!(["data", "out"]));
    let kept = keasy_server::credentials::named(&app.db, "minio")
        .await
        .unwrap();
    assert!(
        matches!(&kept.spec, StorageCredentialInput::S3 { endpoint, .. }
        if endpoint.as_deref() == Some(s3.as_str())),
        "the old spec stands"
    );

    let (status, body) = app
        .send(
            Method::PATCH,
            "/v1/credentials/minio",
            &member,
            json!({ "spec": spec(&s3, "second") }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rotated = keasy_server::credentials::named(&app.db, "minio")
        .await
        .unwrap();
    assert!(
        matches!(&rotated.spec, StorageCredentialInput::S3 { secret_access_key, .. }
        if secrecy::ExposeSecret::expose_secret(secret_access_key) == "second")
    );

    let (status, report) = app
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
