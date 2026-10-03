use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{DEAD, EDITOR, spawn_app};
use keasy_server::domain::Direction;

/// A job needs a destination, and it must be the sink.
#[tokio::test]
async fn a_job_goes_to_the_sink_or_is_refused() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("source", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let create = |sink: Option<&str>| {
        let mut body = json!({ "script": "x" });
        if let Some(sink) = sink {
            body["sink_connection"] = json!(sink);
        }
        app.send(Method::POST, "/v1/jobs", &member, body)
    };

    assert_eq!(create(None).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, body) = create(Some("source")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "job/invalid-destination");
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
    let mine = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &mine,
            json!({ "script": "x", "sink_connection": "sink" }),
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
        (Method::PATCH, path.clone(), json!({ "name": "stolen" })),
        (
            Method::POST,
            format!("{path}/submit"),
            json!({ "folder": "f" }),
        ),
        (
            Method::POST,
            format!("{path}/status"),
            json!({ "status": "running" }),
        ),
        (Method::DELETE, path.clone(), json!(null)),
        (
            Method::POST,
            "/v1/storage-credentials".into(),
            json!({ "scope": { "job": id }, "access": "read" }),
        ),
    ] {
        let (status, _) = app.send(verb.clone(), &route, &theirs, body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{verb} {route}");
    }

    let (status, job) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(job["id"], json!(id));
}

/// A failed run keeps the problem the browser reported, whole: the web
/// branches on its `code` and reads its `data`, so a string would lose both.
#[tokio::test]
async fn a_failed_run_keeps_its_problem_whole() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let id = app.submitted(&member).await;
    let path = format!("/v1/jobs/{id}");
    let problem = json!({
        "code": "run/over-budget",
        "title": "Over budget",
        "detail": "the join asked for 3 GB",
        "severity": "error",
        "data": { "budget": 2, "consumer": "join", "requested": 3, "reserved": 0 },
    });

    let (status, failed) = app
        .report(
            &member,
            &id,
            json!({ "status": "failed", "problem": problem }),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(failed["problem"], problem);
    let (_, read) = app.send(Method::GET, &path, &member, json!(null)).await;
    assert_eq!(read["problem"], problem);
}

/// A job to run names a folder no other job in the sink writes to; a draft
/// may go without, and is never run.
#[tokio::test]
async fn a_job_writes_to_a_folder_of_its_own() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let draft = |folder: Option<&str>| {
        let mut body = json!({ "script": "x", "sink_connection": "sink" });
        if let Some(folder) = folder {
            body["folder"] = json!(folder);
        }
        app.send(Method::POST, "/v1/jobs", &member, body)
    };
    let submit = |id: String, body: serde_json::Value| {
        let member = member.clone();
        let app = &app;
        async move {
            app.send(
                Method::POST,
                &format!("/v1/jobs/{id}/submit"),
                &member,
                body,
            )
            .await
        }
    };
    let id = |job: &serde_json::Value| job["id"].as_str().unwrap().to_string();
    let refused_on = |(status, body): (StatusCode, serde_json::Value)| {
        (
            status,
            body["code"].as_str().map(str::to_owned),
            body["data"]["field"].as_str().map(str::to_owned),
        )
    };
    let on_folder = |status, code: &str| (status, Some(code.to_owned()), Some("folder".to_owned()));

    let (status, body) = draft(Some("Not A Slug")).await;
    assert_eq!(
        refused_on((status, body)),
        on_folder(StatusCode::BAD_REQUEST, "request/invalid")
    );

    let (status, unfiled) = draft(None).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(unfiled["status"], "draft", "a job begins as a draft");
    assert!(unfiled.get("folder").is_none());
    assert_eq!(
        refused_on(submit(id(&unfiled), json!({})).await),
        on_folder(StatusCode::BAD_REQUEST, "request/invalid"),
        "no folder, no run"
    );

    let (_, first) = draft(Some("people")).await;
    let (status, first) = submit(id(&first), json!({})).await;
    assert_eq!(
        (status, first["folder"].as_str()),
        (StatusCode::ACCEPTED, Some("people"))
    );
    let (_, second) = draft(Some("people")).await;
    assert_eq!(
        refused_on(submit(id(&second), json!({})).await),
        on_folder(StatusCode::CONFLICT, "job/folder-taken")
    );

    let path = format!("/v1/jobs/{}", id(&unfiled));
    let (status, edited) = app
        .send(Method::PATCH, &path, &member, json!({ "folder": "people" }))
        .await;
    assert_eq!(
        (status, edited["folder"].as_str()),
        (StatusCode::OK, Some("people")),
        "drafts may share a folder"
    );
    let (status, body) = app
        .send(Method::PATCH, &path, &member, json!({ "folder": "-bad" }))
        .await;
    assert_eq!(
        (status, body["data"]["field"].as_str()),
        (StatusCode::BAD_REQUEST, Some("folder"))
    );
    let (status, _) = app
        .report(&member, &id(&unfiled), json!({ "status": "running" }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "a draft is never run");

    let (status, body) = app
        .send(
            Method::PATCH,
            &format!("/v1/jobs/{}", id(&first)),
            &member,
            json!({ "name": "late" }),
        )
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::CONFLICT, Some("job/not-draft")),
        "a submitted job is not edited"
    );
}

/// A job's dashboard: none until saved, an object no larger than the cap, and
/// its owner's alone.
#[tokio::test]
async fn a_job_keeps_one_dashboard() {
    let app = spawn_app().await;
    let mine = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &mine,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let path = format!("/v1/jobs/{}/dashboard", job["id"].as_str().unwrap());

    let (status, body) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!((status, body), (StatusCode::OK, json!(null)));

    for spec in [json!([1]), json!("x"), json!(null)] {
        let (status, _) = app
            .send(Method::PUT, &path, &mine, json!({ "spec": spec }))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{spec}");
    }
    let huge = "x".repeat(keasy_server::routes::jobs::dashboard::MAX_SPEC_BYTES);
    let (status, _) = app
        .send(
            Method::PUT,
            &path,
            &mine,
            json!({ "spec": { "big": huge } }),
        )
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

    let spec = json!({ "cards": [{ "type": "bar", "x": "age" }] });
    let (status, saved) = app
        .send(Method::PUT, &path, &mine, json!({ "spec": spec }))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["updated_by"], "u-1");
    let (_, read) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(read["spec"], spec);

    let (status, _) = app.send(Method::GET, &path, &theirs, json!(null)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::PUT, &path, &theirs, json!({ "spec": {} }))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// A job's name is spelled as a connection's: a misspelled one is refused on
/// the field that holds it, on create and on edit.
#[tokio::test]
async fn a_misspelled_name_is_refused_on_its_field() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    for name in [" lead", "a/b", "@x", ""] {
        let (status, body) = app
            .send(
                Method::POST,
                "/v1/jobs",
                &member,
                json!({ "script": "x", "sink_connection": "sink", "name": name }),
            )
            .await;
        assert_eq!(
            (
                status,
                body["code"].as_str(),
                body["data"]["field"].as_str()
            ),
            (
                StatusCode::BAD_REQUEST,
                Some("request/invalid"),
                Some("name")
            ),
            "{name:?}"
        );
    }

    let (_, draft) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "sink_connection": "sink", "name": "People" }),
        )
        .await;
    assert_eq!(draft["name"], "People");
    let path = format!("/v1/jobs/{}", draft["id"].as_str().unwrap());
    let (status, body) = app
        .send(Method::PATCH, &path, &member, json!({ "name": "trail " }))
        .await;
    assert_eq!(
        (status, body["data"]["field"].as_str()),
        (StatusCode::BAD_REQUEST, Some("name"))
    );
}

/// Submitting turns the draft into the job to run in place: the same id, one
/// job listed, pending, and dated now — a draft written an hour ago is not
/// swept the moment it is submitted.
#[tokio::test]
async fn submitting_a_draft_makes_it_the_job_in_place() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let (_, draft) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let id = draft["id"].as_str().unwrap().to_string();
    let hour_ago = "2000-01-01T00:00:00Z";
    app.db
        .write()
        .await
        .execute("UPDATE jobs SET created_at = ?1", [hour_ago])
        .unwrap();
    let submit = format!("/v1/jobs/{id}/submit");

    let (status, body) = app.send(Method::POST, &submit, &member, json!({})).await;
    assert_eq!(
        (status, body["data"]["field"].as_str()),
        (StatusCode::BAD_REQUEST, Some("folder")),
        "no folder, no run"
    );
    let (status, body) = app
        .send(Method::POST, &submit, &member, json!({ "name": "/" }))
        .await;
    assert_eq!(
        (status, body["data"]["field"].as_str()),
        (StatusCode::BAD_REQUEST, Some("name"))
    );

    let (status, job) = app
        .send(
            Method::POST,
            &submit,
            &member,
            json!({ "script": "y", "name": "People", "folder": "people" }),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(job["id"], json!(id));
    assert_eq!(job["status"], "pending");
    assert_eq!(
        (job["script"].as_str(), job["name"].as_str()),
        (Some("y"), Some("People"))
    );
    assert_eq!(
        job["created_at"], hour_ago,
        "a job is dated when it was made"
    );
    assert!(
        job["heartbeat_at"].as_str() > Some(hour_ago),
        "its lease starts at submit, so a draft written an hour ago is not swept"
    );

    let (_, listed) = app
        .send(Method::GET, "/v1/jobs", &member, json!(null))
        .await;
    let listed = listed.as_array().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0]["id"].as_str(), listed[0]["status"].as_str()),
        (Some(&*id), Some("pending"))
    );

    let (status, body) = app.send(Method::POST, &submit, &member, json!({})).await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::CONFLICT, Some("job/not-draft"))
    );
    let theirs = app.token_for("u-2", EDITOR);
    let (status, _) = app.send(Method::POST, &submit, &theirs, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// A draft submitted onto a folder another job holds is refused on the
/// folder, and stays the draft it was.
#[tokio::test]
async fn submitting_onto_a_taken_folder_leaves_the_draft() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let create = |body: serde_json::Value| app.send(Method::POST, "/v1/jobs", &member, body);
    let (_, held) =
        create(json!({ "script": "x", "sink_connection": "sink", "folder": "people" })).await;
    let held = format!("/v1/jobs/{}/submit", held["id"].as_str().unwrap());
    app.send(Method::POST, &held, &member, json!({})).await;
    let (_, draft) = create(json!({
        "script": "x", "sink_connection": "sink", "name": "Mine",
    }))
    .await;
    let path = format!("/v1/jobs/{}", draft["id"].as_str().unwrap());

    let (status, body) = app
        .send(
            Method::POST,
            &format!("{path}/submit"),
            &member,
            json!({ "name": "Renamed", "folder": "people" }),
        )
        .await;
    assert_eq!(
        (
            status,
            body["code"].as_str(),
            body["data"]["field"].as_str()
        ),
        (
            StatusCode::CONFLICT,
            Some("job/folder-taken"),
            Some("folder")
        )
    );
    let (_, read) = app.send(Method::GET, &path, &member, json!(null)).await;
    assert_eq!(read["status"], "draft");
    assert_eq!(read["name"], "Mine");
    assert!(read.get("folder").is_none());
}

/// A run moves forward only: from running it reports running again, or one of
/// its ends, and every end is dated. Never back to a draft or to pending.
#[tokio::test]
async fn a_run_reports_forward_and_every_end_is_dated() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    for target in ["completed", "failed", "cancelled", "draft", "pending"] {
        let id = app.submitted(&member).await;
        let report = |status: &str| app.report(&member, &id, json!({ "status": status }));
        let (status, running) = report("running").await;
        assert_eq!(
            (status, running["status"].as_str()),
            (StatusCode::NO_CONTENT, Some("running"))
        );
        assert!(running.get("completed_at").is_none());

        let (status, body) = report(target).await;
        match target {
            "draft" | "pending" => {
                assert_eq!(status, StatusCode::BAD_REQUEST, "running → {target}");
                let (_, read) = app
                    .send(Method::GET, &format!("/v1/jobs/{id}"), &member, json!(null))
                    .await;
                assert_eq!(read["status"], "running", "running → {target}");
            }
            ended => {
                assert_eq!(status, StatusCode::NO_CONTENT, "running → {ended}");
                assert_eq!(body["status"], ended);
                assert!(body["completed_at"].is_string(), "{ended} is dated");
            }
        }
    }
}
