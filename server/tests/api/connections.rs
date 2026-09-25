use axum::http::{Method, StatusCode};
use secrecy::SecretString;
use serde_json::json;

use crate::helpers::{DEAD, spawn_app, unprobed};
use keasy_server::domain::{CredentialSpecInput, Direction, ResourceName};

/// The credential a connection uses cannot be deleted, nor the sink a job wrote
/// to; the refusal names what is in the way.
#[tokio::test]
async fn what_is_in_use_is_not_deleted() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    let owner = app.token_for("u-owner", &["owner"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("data", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let (status, body) = app
        .send(Method::DELETE, "/v1/credentials/key", &member, json!(null))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "in_use");
    assert_eq!(body["dependents"], json!(["data", "sink"]));

    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "draft": true, "sink_connection": "sink" }),
        )
        .await;
    let (status, body) = app
        .send(Method::DELETE, "/v1/connections/sink", &owner, json!(null))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["dependents"], json!([job["id"]]));

    assert_eq!(
        app.send(Method::DELETE, "/v1/connections/data", &member, json!(null))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
}

/// A storage connection cannot sign with a model key: refused before any probe.
#[tokio::test]
async fn a_connection_names_a_credential_of_its_own_purpose() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    let model = CredentialSpecInput::Model(keasy_server::domain::ModelCredentialInput::Anthropic {
        api_key: SecretString::from("sk"),
    });
    keasy_server::credentials::persistence::insert(
        &*app.db.write().await,
        app.db.secret_key(),
        &ResourceName::parse("claude").unwrap(),
        &model,
        "u-1",
        &unprobed(),
    )
    .unwrap();
    let (status, body) = app
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
