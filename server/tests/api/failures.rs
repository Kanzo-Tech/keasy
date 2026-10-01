//! Every failure the server can answer, in the one shape: `{code, title,
//! detail, data}` — whoever produced it, the handler or axum before it.

use axum::http::{Method, StatusCode, header};
use serde_json::json;

use crate::helpers::{DEAD, TestApp, spawn_app};
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
    let member = app.token(&["member"]);
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
            "a query that does not parse",
            c.get(url(&app, "/v1/connections?purpose=bogus"))
                .bearer_auth(&member),
            StatusCode::BAD_REQUEST,
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
    let member = app.token(&["member"]);
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
    let member = app.token(&["member"]);
    for (path, code) in [
        ("/v1/jobs/nope", "job/not-found"),
        ("/v1/connections/nope", "connection/not-found"),
        ("/v1/credentials/nope", "credential/not-found"),
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

async fn submitted(app: &TestApp, member: &str) -> String {
    let (status, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            member,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    job["id"].as_str().unwrap().to_string()
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
    let member = app.token(&["member"]);
    sink(&app).await;
    let id = submitted(&app, &member).await;
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
/// to failed with `job/abandoned`, the runner can no longer report on it,
/// and it can be deleted.
#[tokio::test]
async fn a_run_whose_runner_went_silent_ends_as_abandoned_and_can_be_deleted() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    sink(&app).await;
    let id = submitted(&app, &member).await;
    let path = format!("/v1/jobs/{id}");

    let (status, running) = app
        .send(
            Method::PATCH,
            &path,
            &member,
            json!({ "status": "running" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(running["heartbeat_at"].is_string());
    let beat = format!("{path}/heartbeat");
    assert_eq!(
        app.call(Method::POST, &beat, Some(&member)).await,
        StatusCode::NO_CONTENT
    );

    age(&app, &id, "heartbeat_at", 61).await;

    let (_, listed) = app
        .send(Method::GET, "/v1/jobs", &member, json!(null))
        .await;
    let job = &listed[0];
    assert_eq!(job["status"], "failed");
    assert_eq!(job["problem"]["code"], "job/abandoned");

    let (status, code) = app.answer(Method::POST, &beat, Some(&member)).await;
    assert_eq!(
        (status, code.as_deref()),
        (StatusCode::CONFLICT, Some("job/not-running"))
    );
    let (status, body) = app
        .send(
            Method::PATCH,
            &path,
            &member,
            json!({ "status": "completed" }),
        )
        .await;
    assert_eq!(
        (status, body["code"].clone()),
        (StatusCode::CONFLICT, json!("job/not-running"))
    );

    assert_eq!(
        app.call(Method::DELETE, &path, Some(&member)).await,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn a_pending_job_no_runner_picked_up_ends_as_abandoned() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    sink(&app).await;
    let id = submitted(&app, &member).await;
    age(&app, &id, "created_at", 61).await;

    let (_, job) = app
        .send(Method::GET, &format!("/v1/jobs/{id}"), &member, json!(null))
        .await;
    assert_eq!(job["status"], "failed");
    assert_eq!(job["problem"]["code"], "job/abandoned");
}

#[tokio::test]
async fn a_store_that_refuses_to_vend_is_store_refused() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    sink(&app).await;
    let id = submitted(&app, &member).await;
    let path = format!("/v1/jobs/{id}");
    app.send(
        Method::PATCH,
        &path,
        &member,
        json!({ "status": "running" }),
    )
    .await;

    let response = app
        .client
        .post(url(&app, &format!("{path}/credentials")))
        .bearer_auth(&member)
        .json(&json!({ "access": "write" }))
        .send()
        .await
        .unwrap();
    let (status, body) = refused(response).await;
    assert_eq!(
        (status, body["code"].as_str().unwrap()),
        (StatusCode::BAD_GATEWAY, "store/refused")
    );
}

#[tokio::test]
async fn a_model_call_without_a_model_connection_says_so() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    let request = |connection: Option<&str>| {
        let mut body = json!({ "system": "s", "messages": [] });
        if let Some(name) = connection {
            body["connection"] = json!(name);
        }
        app.client
            .post(url(&app, "/v1/ai/stream"))
            .bearer_auth(&member)
            .json(&body)
            .send()
    };
    let (status, body) = refused(request(None).await.unwrap()).await;
    assert_eq!(
        (status, body["code"].as_str().unwrap()),
        (StatusCode::BAD_REQUEST, "llm/not-configured")
    );
    let (status, body) = refused(request(Some("gone")).await.unwrap()).await;
    assert_eq!(
        (status, body["code"].as_str().unwrap()),
        (StatusCode::NOT_FOUND, "connection/not-found")
    );
}
