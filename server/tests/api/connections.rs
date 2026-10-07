use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{ADMIN, EDITOR, spawn_app, spawn_app_on};
use keasy_server::domain::Direction;

/// The credential a connection uses cannot be deleted, nor the sink a graph wrote
/// to; the refusal names what is in the way.
#[tokio::test]
async fn what_is_in_use_is_not_deleted() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    let owner = app.token_for("u-owner", ADMIN);
    app.credential("key", "u-1").await;
    app.connection("data", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let (status, body) = app
        .send(Method::DELETE, "/v1/secrets/key", &member, json!(null))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "resource/in-use");
    assert_eq!(body["data"]["dependents"], json!(["data", "sink"]));

    let (_, graph) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &member,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let (status, body) = app
        .send(Method::DELETE, "/v1/connections/sink", &owner, json!(null))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["data"]["dependents"], json!([graph["id"]]));

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
    let member = app.token(EDITOR);
    app.credential("key", "u-1").await;
    app.connection("data", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    for (url, collides) in [
        ("s3://b/", vec!["data", "sink"]),
        ("s3a://b/sink/", vec!["sink"]),
        ("s3://b/sink/graph-1/", vec!["sink"]),
        ("s3://b/data/nested", vec!["data"]),
    ] {
        let (status, body) = app
            .send(
                Method::POST,
                "/v1/connections",
                &member,
                json!({ "name": "other", "secret": "key",
                        "target": { "url": url, "direction": "source" } }),
            )
            .await;
        assert_eq!(status, StatusCode::CONFLICT, "{url}: {body}");
        assert_eq!(body["code"], "connection/overlaps", "{url}");
        assert_eq!(body["data"]["dependents"], json!(collides), "{url}");
    }

    let (status, body) = app
        .send(
            Method::POST,
            "/v1/connections",
            &member,
            json!({ "name": "other", "secret": "key",
                    "target": { "url": "s3://b/data-private/", "direction": "source" } }),
        )
        .await;
    assert_ne!(
        status,
        StatusCode::CONFLICT,
        "a sibling prefix is not an overlap: {body}"
    );
}

/// A store holding three objects under every prefix.
async fn three_objects() -> String {
    use axum::http::header;
    use axum::response::IntoResponse;
    async fn answer(uri: axum::http::Uri) -> axum::response::Response {
        let prefix = uri
            .query()
            .and_then(|q| q.split('&').find_map(|kv| kv.strip_prefix("prefix=")))
            .unwrap_or_default()
            .replace("%2F", "/");
        let contents: String = (0..3)
            .map(|i| {
                format!(
                    "<Contents><Key>{prefix}f{i}.csv</Key><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>\"e\"</ETag><Size>1</Size></Contents>"
                )
            })
            .collect();
        (
            [(header::CONTENT_TYPE, "application/xml")],
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><KeyCount>3</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>{contents}</ListBucketResult>"#
            ),
        )
            .into_response()
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, axum::Router::new().fallback(answer))
            .await
            .unwrap();
    });
    format!("http://{addr}")
}

/// A listing is a page: under the prefix it is asked for, which never leaves
/// the connection's own, and at most `limit` long, saying whether there was more.
#[tokio::test]
async fn a_listing_stays_under_its_prefix_and_says_when_it_was_cut() {
    let app = spawn_app_on(&three_objects().await).await;
    let member = app.token(EDITOR);
    app.credential("key", "u-1").await;
    app.connection("data", "key", Direction::Source, "u-1")
        .await;

    let (app, member) = (&app, &member);
    let list = |query: &'static str| async move {
        let (status, body) = app
            .send(
                Method::GET,
                &format!("/v1/connections/data/files{query}"),
                member,
                json!(null),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let paths: Vec<String> = body["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["path"].as_str().unwrap().to_owned())
            .collect();
        (paths, body["truncated"].clone())
    };
    assert_eq!(
        list("?prefix=dynamic/").await,
        (
            vec![
                "data/dynamic/f0.csv".to_owned(),
                "data/dynamic/f1.csv".to_owned(),
                "data/dynamic/f2.csv".to_owned()
            ],
            json!(false)
        )
    );
    let (paths, truncated) = list("?limit=2").await;
    assert_eq!((paths.len(), truncated), (2, json!(true)));
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let (status, _) = app
        .send(
            Method::GET,
            "/v1/connections/sink/files",
            member,
            json!(null),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "the sink is reached through its graphs"
    );
    for prefix in ["..", "a/../b", "a//b"] {
        let (status, body) = app
            .send(
                Method::GET,
                &format!("/v1/connections/data/files?prefix={prefix}"),
                member,
                json!(null),
            )
            .await;
        assert_eq!(
            (status, body["data"]["field"].as_str()),
            (StatusCode::BAD_REQUEST, Some("prefix")),
            "{prefix}"
        );
    }
}
