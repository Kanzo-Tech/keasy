use axum::http::header::{CACHE_CONTROL, LOCATION};
use axum::http::{HeaderMap, Method, StatusCode};
use serde_json::json;

use crate::helpers::{DEAD, TestApp, spawn_app};
use keasy_server::domain::Direction;

fn location(headers: &HeaderMap) -> String {
    headers[LOCATION].to_str().unwrap().to_owned()
}

fn signature(location: &str) -> String {
    let url = url::Url::parse(location).unwrap();
    url.query_pairs()
        .find(|(k, _)| k == "X-Amz-Signature")
        .map(|(_, v)| v.into_owned())
        .unwrap()
}

async fn workspace() -> (TestApp, String) {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("source", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    (app, member)
}

/// A reader holds one URL per object for as long as it reads; each request
/// through it is redirected to the store, signed for that request's method —
/// S3 refuses a HEAD sent to a URL signed for GET, and a range reader probes
/// with HEAD.
#[tokio::test]
async fn a_jobs_object_redirects_signed_for_the_method_asked() {
    let (app, member) = workspace().await;
    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "draft": true, "sink_connection": "sink" }),
        )
        .await;
    let id = job["id"].as_str().unwrap();
    let path = format!("/v1/jobs/{id}/objects?path=vertex/Person/tiles.parquet");

    let (status, get) = app.read(Method::GET, &path, &member).await;
    assert_eq!(status, StatusCode::TEMPORARY_REDIRECT);
    assert!(
        location(&get).contains(&format!("/sink/{id}/vertex/Person/tiles.parquet?")),
        "{}",
        location(&get)
    );
    assert_eq!(get[CACHE_CONTROL], "private, max-age=150");

    let (status, head) = app.read(Method::HEAD, &path, &member).await;
    assert_eq!(status, StatusCode::TEMPORARY_REDIRECT);
    assert_ne!(signature(&location(&get)), signature(&location(&head)));

    let escape = format!("/v1/jobs/{id}/objects?path=../other/secret.parquet");
    let (status, body) = app.send(Method::GET, &escape, &member, json!(null)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_path");
}

/// A locator reads through the source it lies under; the sink is read only
/// through the job that wrote it, and a public URL is not keasy's to redirect.
#[tokio::test]
async fn a_locator_redirects_through_its_source_only() {
    let (app, member) = workspace().await;
    let read = |locator: &str| {
        let locator: String = url::form_urlencoded::byte_serialize(locator.as_bytes()).collect();
        format!("/v1/objects?locator={locator}")
    };

    let (status, headers) = app
        .read(Method::GET, &read("s3://b/source/people.csv"), &member)
        .await;
    assert_eq!(status, StatusCode::TEMPORARY_REDIRECT);
    assert!(location(&headers).contains("/source/people.csv?"));

    let (status, _) = app
        .read(
            Method::GET,
            &read("s3://b/sink/job/vertex/Person/tiles.parquet"),
            &member,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, headers) = app
        .read(
            Method::GET,
            &read("https://example.org/people.csv"),
            &member,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!headers.contains_key(LOCATION));
}

/// The bypass that authorised one text and signed another: a dot segment,
/// however it is spelt, is refused where it is written.
#[tokio::test]
async fn a_locator_cannot_climb_out_of_its_source() {
    let (app, member) = workspace().await;
    for locator in [
        "s3://b/source/../sink/job/x.parquet",
        "s3://b/source/%2e%2e/sink/job/x.parquet",
        "s3://b/source/.%2e/sink/job/x.parquet",
        "s3://b/./sink/job/x.parquet",
    ] {
        let encoded: String = url::form_urlencoded::byte_serialize(locator.as_bytes()).collect();
        let (status, headers) = app
            .read(
                Method::GET,
                &format!("/v1/objects?locator={encoded}"),
                &member,
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{locator}");
        assert!(!headers.contains_key(LOCATION), "{locator}");
    }
}
