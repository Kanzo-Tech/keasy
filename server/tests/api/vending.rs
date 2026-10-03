use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{DEAD, TestApp, spawn_app};
use keasy_server::domain::Direction;

async fn workspace() -> (TestApp, String) {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("source", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    (app, member)
}

/// One door, `POST /v1/storage-credentials`, asked what fossil's host is asked:
/// a scope and an access. Its answer as `(status, code)`.
async fn vend(
    app: &TestApp,
    token: &str,
    scope: serde_json::Value,
    access: &str,
) -> (StatusCode, Option<String>) {
    let (status, body) = app
        .send(
            Method::POST,
            "/v1/storage-credentials",
            token,
            json!({ "scope": scope, "access": access }),
        )
        .await;
    (status, body["code"].as_str().map(str::to_owned))
}

/// A job's dataset is vended to read once the job has completed and to write
/// only while it runs; a source only to read; the sink never as a source.
/// These are refused before any store is asked.
#[tokio::test]
async fn a_credential_is_vended_only_for_what_the_state_allows() {
    let (app, member) = workspace().await;
    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "draft": true, "sink_connection": "sink" }),
        )
        .await;
    let job = json!({ "job": job["id"] });
    let conflict = |code: &str| (StatusCode::CONFLICT, Some(code.to_owned()));

    assert_eq!(
        vend(&app, &member, job.clone(), "read").await,
        conflict("job/not-completed")
    );
    assert_eq!(
        vend(&app, &member, job.clone(), "write").await,
        conflict("job/not-running")
    );

    let sink = json!({ "connection": "sink" });
    let source = json!({ "connection": "source" });
    assert_eq!(
        vend(&app, &member, sink, "read").await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        vend(&app, &member, source.clone(), "write").await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        vend(&app, &member, json!({ "connection": "gone" }), "read")
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    let theirs = app.token_for("u-2", &["member"]);
    assert_eq!(
        vend(&app, &theirs, job.clone(), "read").await.0,
        StatusCode::NOT_FOUND
    );

    let owner = app.token_for("u-9", &["owner"]);
    assert_eq!(
        vend(&app, &owner, source, "read").await.0,
        StatusCode::FORBIDDEN,
        "the owner never reads a source"
    );
    assert_eq!(
        vend(&app, &owner, job.clone(), "write").await.0,
        StatusCode::FORBIDDEN,
        "the owner never writes a dataset"
    );
    assert_eq!(
        vend(&app, &owner, job, "read").await,
        conflict("job/not-completed"),
        "the owner reads a member's job, once it has completed"
    );
}

/// A job that ended has nothing left to write: `job/ended`, not "not yet".
#[tokio::test]
async fn an_ended_job_is_never_written() {
    let (app, member) = workspace().await;
    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "sink_connection": "sink", "folder": "out" }),
        )
        .await;
    let id = job["id"].as_str().unwrap();
    app.send(
        Method::PATCH,
        &format!("/v1/jobs/{id}"),
        &member,
        json!({ "status": "cancelled" }),
    )
    .await;
    assert_eq!(
        vend(&app, &member, json!({ "job": id }), "write").await,
        (StatusCode::CONFLICT, Some("job/ended".to_owned()))
    );
}
