use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{ADMIN, DEAD, EDITOR, TestApp, spawn_app};
use keasy_server::domain::Direction;

async fn workspace() -> (TestApp, String) {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
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
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let job = json!({ "job": job["id"] });
    let conflict = |code: &str| (StatusCode::CONFLICT, Some(code.to_owned()));

    assert_eq!(
        app.vend(&member, job.clone(), "read").await,
        conflict("job/not-completed")
    );
    assert_eq!(
        app.vend(&member, job.clone(), "write").await,
        conflict("job/not-running")
    );

    let sink = json!({ "connection": "sink" });
    let source = json!({ "connection": "source" });
    assert_eq!(
        app.vend(&member, sink, "read").await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.vend(&member, source.clone(), "write").await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.vend(&member, json!({ "connection": "gone" }), "read")
            .await
            .0,
        StatusCode::NOT_FOUND
    );

    let theirs = app.token_for("u-2", EDITOR);
    assert_eq!(
        app.vend(&theirs, job.clone(), "read").await.0,
        StatusCode::NOT_FOUND
    );

    let owner = app.token_for("u-9", ADMIN);
    assert_eq!(
        app.vend(&owner, source, "read").await,
        (StatusCode::FORBIDDEN, Some("rbac/forbidden".to_owned())),
        "the owner never reads a source"
    );
    assert_eq!(
        app.vend(&owner, job.clone(), "write").await.0,
        StatusCode::FORBIDDEN,
        "the owner never writes a dataset"
    );
    assert_eq!(
        app.vend(&owner, job, "read").await,
        conflict("job/not-completed"),
        "the owner reads a member's job, once it has completed"
    );
}

/// A job that ended has nothing left to write: `job/ended`, not "not yet".
#[tokio::test]
async fn an_ended_job_is_never_written() {
    let (app, member) = workspace().await;
    let id = app.submitted(&member).await;
    app.report(&member, &id, json!({ "status": "cancelled" }))
        .await;
    assert_eq!(
        app.vend(&member, json!({ "job": id }), "write").await,
        (StatusCode::CONFLICT, Some("job/ended".to_owned()))
    );
}
