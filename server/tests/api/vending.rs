use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{ADMIN, DEAD, EDITOR, READER, TestApp, spawn_app};
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

    // Reading is everyone's, so another editor meets the job's state like its
    // creator does; writing is not theirs.
    let theirs = app.token_for("u-2", EDITOR);
    assert_eq!(
        app.vend(&theirs, job.clone(), "read").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        app.vend(&theirs, job.clone(), "write").await,
        (StatusCode::FORBIDDEN, Some("rbac/forbidden".to_owned()))
    );

    // A reader explores outputs; building from a source is an editor's.
    let reader = app.token_for("u-3", READER);
    assert_eq!(
        app.vend(&reader, source.clone(), "read").await,
        (
            StatusCode::FORBIDDEN,
            Some("rbac/insufficient-role".to_owned())
        )
    );
    assert_eq!(
        app.vend(&reader, job.clone(), "read").await,
        conflict("job/not-completed"),
        "a reader reads any job, once it has completed"
    );

    // An admin is an editor too, and may change anyone's job.
    let admin = app.token_for("u-9", ADMIN);
    assert_eq!(
        app.vend(&admin, source, "read").await.0,
        StatusCode::BAD_GATEWAY,
        "refused by the store, never by role"
    );
    assert_eq!(
        app.vend(&admin, job, "write").await,
        conflict("job/not-running")
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
