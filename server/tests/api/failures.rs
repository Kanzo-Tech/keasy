//! Every failure the server can answer, in the one shape: `{code, title,
//! detail, data}` — whoever produced it, the handler or axum before it. (No
//! route takes a query string, so a `Query` rejection has nothing to be tested on.)

use axum::http::{Method, StatusCode, header};
use serde_json::json;

use crate::helpers::{DEAD, EDITOR, TestApp, spawn_app};
use keasy_server::domain::Direction;

/// The status and the whole body, which must be an `ErrorBody`.
async fn refused(response: reqwest::Response) -> (StatusCode, serde_json::Value) {
    let status = response.status();
    let body: serde_json::Value = response.json().await.expect("an error body is JSON");
    for field in ["code", "title", "detail"] {
        assert!(body[field].is_string(), "{field} in {body}");
    }
    assert!(body["data"].is_object(), "data in {body}");
    (status, body)
}

fn url(app: &TestApp, path: &str) -> String {
    format!("{}{path}", app.address)
}

#[tokio::test]
async fn what_axum_refuses_before_a_handler_speaks_error_body_too() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    let c = &app.client;

    let cases = [
        (
            "no route",
            c.get(url(&app, "/v1/nothing-here")).bearer_auth(&member),
            StatusCode::NOT_FOUND,
            "route/not-found",
        ),
        (
            "a method the route does not take",
            c.patch(url(&app, "/v1/jobs")).bearer_auth(&member),
            StatusCode::METHOD_NOT_ALLOWED,
            "request/method-not-allowed",
        ),
        (
            "JSON that does not parse",
            c.post(url(&app, "/v1/jobs"))
                .bearer_auth(&member)
                .header(header::CONTENT_TYPE, "application/json")
                .body("{"),
            StatusCode::BAD_REQUEST,
            "request/malformed",
        ),
        (
            "no content type",
            c.post(url(&app, "/v1/jobs"))
                .bearer_auth(&member)
                .body("{}"),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "request/malformed",
        ),
        (
            "a body missing a field",
            c.post(url(&app, "/v1/jobs"))
                .bearer_auth(&member)
                .json(&json!({ "script": "x" })),
            StatusCode::UNPROCESSABLE_ENTITY,
            "request/malformed",
        ),
        (
            "a body over the limit",
            c.post(url(&app, "/v1/jobs"))
                .bearer_auth(&member)
                .header(header::CONTENT_TYPE, "application/json")
                .body(vec![b' '; 3 * 1024 * 1024]),
            StatusCode::PAYLOAD_TOO_LARGE,
            "request/too-large",
        ),
    ];
    for (what, request, status, code) in cases {
        let (got, body) = refused(request.send().await.unwrap()).await;
        assert_eq!(
            (got, body["code"].as_str().unwrap()),
            (status, code),
            "{what}: {body}"
        );
    }
}

#[tokio::test]
async fn a_rejection_keeps_axums_words_as_the_detail() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    let response = app
        .client
        .post(url(&app, "/v1/jobs"))
        .bearer_auth(&member)
        .json(&json!({ "script": "x" }))
        .send()
        .await
        .unwrap();
    let (_, body) = refused(response).await;
    assert!(
        body["detail"].as_str().unwrap().contains("sink_connection"),
        "{body}"
    );
}

#[tokio::test]
async fn each_resource_that_is_not_there_says_which() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    for (path, code) in [
        ("/v1/jobs/nope", "job/not-found"),
        ("/v1/connections/nope", "connection/not-found"),
        ("/v1/secrets/nope", "secret/not-found"),
    ] {
        let response = app
            .client
            .get(url(&app, path))
            .bearer_auth(&member)
            .send()
            .await
            .unwrap();
        let (status, body) = refused(response).await;
        assert_eq!(
            (status, body["code"].as_str().unwrap()),
            (StatusCode::NOT_FOUND, code)
        );
    }
}

async fn sink(app: &TestApp) {
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
}

async fn age(app: &TestApp, id: &str, column: &str, seconds: i64) {
    let then = (jiff::Timestamp::now() - jiff::SignedDuration::from_secs(seconds))
        .strftime("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    app.db
        .write()
        .await
        .execute(
            &format!("UPDATE jobs SET {column} = ?1 WHERE id = ?2"),
            [then.as_str(), id],
        )
        .unwrap();
}

#[tokio::test]
async fn a_running_job_is_refused_deletion_with_its_code() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    sink(&app).await;
    let id = app.running(&member).await;
    let (status, body) = app
        .send(
            Method::DELETE,
            &format!("/v1/jobs/{id}"),
            &member,
            json!(null),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "job/still-running");
}

/// A run whose tab closed ends: its heartbeat stops, the next read sweeps it
/// to failed with `job/abandoned`, the runner can no longer report on it (`job/ended`),
/// and it can be deleted.
#[tokio::test]
async fn a_run_whose_runner_went_silent_ends_as_abandoned_and_can_be_deleted() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    sink(&app).await;
    let id = app.running(&member).await;
    let path = format!("/v1/jobs/{id}");

    let (status, running) = app
        .report(&member, &id, json!({ "status": "running" }))
        .await;
    assert_eq!(status, StatusCode::OK);
    let started = running["heartbeat_at"].clone();
    assert!(started.is_string());
    age(&app, &id, "heartbeat_at", 30).await;
    let (status, renewed) = app
        .report(&member, &id, json!({ "status": "running" }))
        .await;
    assert_eq!(status, StatusCode::OK, "running again renews the lease");
    assert!(
        renewed["heartbeat_at"].as_str() >= started.as_str(),
        "the lease aged 30 s is renewed to now"
    );
    assert_eq!(renewed["started_at"], running["started_at"]);

    age(&app, &id, "heartbeat_at", 61).await;

    let (_, listed) = app
        .send(Method::GET, "/v1/jobs", &member, json!(null))
        .await;
    let job = &listed[0];
    assert_eq!(job["status"], "failed");
    assert_eq!(job["problem"]["code"], "job/abandoned");

    for status in ["running", "completed"] {
        let (got, body) = app.report(&member, &id, json!({ "status": status })).await;
        assert_eq!(
            (got, body["code"].as_str()),
            (StatusCode::CONFLICT, Some("job/ended")),
            "{status}"
        );
    }

    assert_eq!(
        app.call(Method::DELETE, &path, Some(&member)).await,
        StatusCode::NO_CONTENT
    );
}

/// Only a run is swept: an idle job waits for someone to run it, however long.
#[tokio::test]
async fn an_idle_job_waits_and_is_never_swept() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    sink(&app).await;
    let id = app.submitted(&member).await;
    age(&app, &id, "created_at", 3600).await;

    let (_, job) = app
        .send(Method::GET, &format!("/v1/jobs/{id}"), &member, json!(null))
        .await;
    assert_eq!(job["status"], "idle");
}

#[tokio::test]
async fn a_store_that_refuses_to_vend_is_store_refused() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    sink(&app).await;
    let id = app.running(&member).await;

    assert_eq!(
        app.vend(&member, json!({ "job": id }), "write").await,
        (StatusCode::BAD_GATEWAY, Some("store/refused".to_owned()))
    );
}

/// A caller over their rate is refused with `request/rate-limited`, in the one shape. The e2e
/// suite cannot reach the limit through the dev BFF, which serves about as fast as the bucket
/// refills; the server, asked directly, can be outrun.
#[tokio::test]
async fn a_burst_over_the_rate_is_refused_as_request_rate_limited() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    let answers = futures::future::join_all((0..1200).map(|_| {
        app.client
            .get(url(&app, "/v1/connections"))
            .bearer_auth(&member)
            .send()
    }))
    .await;
    // The first answer that is not a listing has to be the limiter's: a 404 fails here too.
    let over = answers
        .into_iter()
        .flatten()
        .find(|answer| answer.status() != StatusCode::OK)
        .expect("some of the burst was refused");
    let (status, body) = refused(over).await;
    assert_eq!(
        (status, body["code"].as_str().unwrap()),
        (StatusCode::TOO_MANY_REQUESTS, "request/rate-limited")
    );
}

/// A store that accepts and never answers is the whole answer, `store/silent` with how long it was
/// given — from a probe as from a listing, and inside the request deadline, so never a failed check
/// in a report nor `server/silent`.
#[tokio::test]
async fn a_store_that_never_answers_is_store_silent_from_a_probe_and_a_listing() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let silent = format!("http://{}", listener.local_addr().unwrap());
    app.credential("hung", &silent, "u-1").await;
    app.connection("data", "hung", Direction::Source, "u-1")
        .await;

    let spec = json!({ "kind": "s3", "access_key_id": "AK", "secret_access_key": "s", "endpoint": silent });
    let started = std::time::Instant::now();
    let (created, validated, listed) = tokio::join!(
        app.send(
            Method::POST,
            "/v1/secrets",
            &member,
            json!({ "name": "fresh", "spec": spec, "probe_url": "s3://b/" }),
        ),
        app.send(
            Method::POST,
            "/v1/connections/data/validate",
            &member,
            json!({})
        ),
        async {
            let response = app
                .client
                .get(url(&app, "/v1/connections/data/files"))
                .bearer_auth(&member)
                .send()
                .await
                .unwrap();
            refused(response).await
        },
    );
    for (what, (status, body)) in [
        ("create", created),
        ("validate", validated),
        ("list", listed),
    ] {
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::GATEWAY_TIMEOUT, Some("store/silent")),
            "{what}: {body}"
        );
        assert!(body["data"]["after"].is_u64(), "{what}: {body}");
    }
    assert!(started.elapsed() < keasy_server::startup::REQUEST_DEADLINE);
}
