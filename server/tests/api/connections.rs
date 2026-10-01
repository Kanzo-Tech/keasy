use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{DEAD, spawn_app};
use keasy_server::domain::Direction;

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
    assert_eq!(body["code"], "in_use");
    assert_eq!(body["data"]["dependents"], json!(["data", "sink"]));

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
    assert_eq!(body["data"]["dependents"], json!([job["id"]]));

    assert_eq!(
        app.send(Method::DELETE, "/v1/connections/data", &member, json!(null))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
}

/// Storage locations never overlap — Unity Catalog's rule for external
/// locations. A source cannot hold the sink, sit inside it, or share a prefix
/// with another source, however its URL is spelt; the refusal names who it
/// collides with, and comes before any probe.
#[tokio::test]
async fn a_storage_location_never_overlaps_another() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("data", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    for (url, collides) in [
        ("s3://b/", vec!["data", "sink"]),
        ("s3a://b/sink/", vec!["sink"]),
        ("s3://b/sink/job-1/", vec!["sink"]),
        ("s3://b/data/nested", vec!["data"]),
    ] {
        let (status, body) = app
            .send(
                Method::POST,
                "/v1/connections",
                &member,
                json!({ "name": "other", "credential": "key",
                        "target": { "url": url, "direction": "source" } }),
            )
            .await;
        assert_eq!(status, StatusCode::CONFLICT, "{url}: {body}");
        assert_eq!(body["code"], "overlaps", "{url}");
        assert_eq!(body["data"]["dependents"], json!(collides), "{url}");
    }

    let (status, body) = app
        .send(
            Method::POST,
            "/v1/connections",
            &member,
            json!({ "name": "other", "credential": "key",
                    "target": { "url": "s3://b/data-private/", "direction": "source" } }),
        )
        .await;
    assert_ne!(
        status,
        StatusCode::CONFLICT,
        "a sibling prefix is not an overlap: {body}"
    );
}
