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
    let id = job["id"].as_str().unwrap();
    let vend = |path: String, access: &'static str| {
        let app = &app;
        let member = member.clone();
        async move {
            app.send(Method::POST, &path, &member, json!({ "access": access }))
                .await
        }
    };

    let (status, body) = vend(format!("/v1/jobs/{id}/credentials"), "read").await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::CONFLICT, Some("not_completed"))
    );
    let (status, body) = vend(format!("/v1/jobs/{id}/credentials"), "write").await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::CONFLICT, Some("not_running"))
    );

    let (status, _) = vend("/v1/connections/sink/credentials".into(), "read").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = vend("/v1/connections/source/credentials".into(), "write").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let theirs = app.token_for("u-2", &["member"]);
    let (status, _) = app
        .send(
            Method::POST,
            &format!("/v1/jobs/{id}/credentials"),
            &theirs,
            json!({ "access": "read" }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
