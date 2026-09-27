use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{DEAD, spawn_app};
use keasy_server::domain::Direction;

/// A job needs a destination, and it must be the sink.
#[tokio::test]
async fn a_job_goes_to_the_sink_or_is_refused() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("source", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let create = |sink: Option<&str>| {
        let mut body = json!({ "script": "x", "draft": true });
        if let Some(sink) = sink {
            body["sink_connection"] = json!(sink);
        }
        app.send(Method::POST, "/v1/jobs", &member, body)
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
    let app = spawn_app().await;
    let mine = app.token_for("u-1", &["member"]);
    let theirs = app.token_for("u-2", &["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &mine,
            json!({ "script": "x", "draft": true, "sink_connection": "sink" }),
        )
        .await;
    let id = job["id"].as_str().unwrap().to_string();
    let path = format!("/v1/jobs/{id}");

    let (_, listed) = app
        .send(Method::GET, "/v1/jobs", &theirs, json!(null))
        .await;
    assert_eq!(listed, json!([]));
    let (_, listed) = app.send(Method::GET, "/v1/jobs", &mine, json!(null)).await;
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
            Method::GET,
            format!("{path}/objects?path=a.parquet"),
            json!(null),
        ),
        (
            Method::PUT,
            format!("{path}/relations"),
            json!({ "relations": [] }),
        ),
    ] {
        let (status, _) = app.send(verb.clone(), &route, &theirs, body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{verb} {route}");
    }

    let (status, job) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(job["id"], json!(id));
}
