use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{ADMIN, DEAD, EDITOR, spawn_app};
use keasy_server::domain::Direction;

/// The owner's datasets are the workspace's completed jobs, each where its
/// corpus is; keasy says nothing of what a corpus holds. The owner opens one
/// with a read credential for its job — asked of the store here, which is
/// dead, so the guard's yes is a 502 and not a 403 or 409.
#[tokio::test]
async fn a_completed_job_is_a_dataset_the_owner_opens() {
    let app = spawn_app().await;
    let member = app.token_for("u-1", EDITOR);
    let owner = app.token_for("u-9", ADMIN);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let done = app.submitted(&member).await;
    let report = json!({ "dest": "s3://b/sink/out/", "dropped": [] });
    app.report(&member, &done, json!({ "status": "running" }))
        .await;
    let (status, job) = app
        .report(
            &member,
            &done,
            json!({ "status": "completed", "report": report }),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(job["report"], report, "the run report is kept verbatim");
    let running = app.submitted(&member).await;
    app.report(&member, &running, json!({ "status": "running" }))
        .await;

    let (status, datasets) = app
        .send(Method::GET, "/v1/datasets", &owner, json!(null))
        .await;
    assert_eq!(status, StatusCode::OK);
    let datasets = datasets.as_array().unwrap();
    assert_eq!(datasets.len(), 1, "only a completed job is a dataset");
    assert_eq!(datasets[0]["id"], json!(done));
    assert_eq!(datasets[0]["completed_at"], job["completed_at"]);
    let dest = datasets[0]["dest"].as_str().unwrap();
    assert!(
        dest.starts_with("s3://b/sink/")
            && dest.ends_with(&format!("{}/", job["folder"].as_str().unwrap())),
        "{dest}"
    );

    let read = |id: &str| json!({ "job": id });
    assert_eq!(
        app.vend(&owner, read(&done), "read").await,
        (StatusCode::BAD_GATEWAY, Some("store/refused".to_owned()))
    );
    assert_eq!(
        app.vend(&owner, read(&running), "read").await,
        (StatusCode::CONFLICT, Some("job/not-completed".to_owned()))
    );
    let theirs = app.token_for("u-2", EDITOR);
    assert_eq!(
        app.vend(&theirs, read(&done), "read").await.0,
        StatusCode::NOT_FOUND
    );
}
