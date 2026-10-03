use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{DEAD, good, mint, spawn_app};
use keasy_server::domain::Direction;

/// A job needs a destination, and it must be the sink.
#[tokio::test]
async fn a_job_goes_to_the_sink_or_is_refused() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("source", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let create = |sink: Option<&str>| {
        let mut body = json!({ "script": "x", "draft": true });
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
    let mine = app.token_for("u-1", &["member"]);
    let theirs = app.token_for("u-2", &["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &mine,
            json!({ "script": "x", "draft": true, "sink_connection": "sink" }),
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
        (Method::PUT, path.clone(), json!({ "name": "stolen" })),
        (Method::PATCH, path.clone(), json!({ "status": "running" })),
        (Method::DELETE, path.clone(), json!(null)),
        (
            Method::POST,
            format!("{path}/credentials"),
            json!({ "access": "read" }),
        ),
        (
            Method::PUT,
            format!("{path}/relations"),
            json!({ "relations": [] }),
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
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "sink_connection": "sink", "folder": "out" }),
        )
        .await;
    let path = format!("/v1/jobs/{}", job["id"].as_str().unwrap());
    let problem = json!({
        "code": "run/over-budget",
        "title": "Over budget",
        "detail": "the join asked for 3 GB",
        "severity": "error",
        "data": { "budget": 2, "consumer": "join", "requested": 3, "reserved": 0 },
    });

    let (status, failed) = app
        .send(
            Method::PATCH,
            &path,
            &member,
            json!({ "status": "failed", "problem": problem }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(failed["problem"], problem);
    let (_, read) = app.send(Method::GET, &path, &member, json!(null)).await;
    assert_eq!(read["problem"], problem);
}

/// A job to run names a folder no other job in the sink writes to; a draft
/// may go without, and is never run.
#[tokio::test]
async fn a_job_writes_to_a_folder_of_its_own() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let create = |body: serde_json::Value| app.send(Method::POST, "/v1/jobs", &member, body);
    let job = |folder: Option<&str>, draft: bool| {
        let mut body = json!({ "script": "x", "sink_connection": "sink", "draft": draft });
        if let Some(folder) = folder {
            body["folder"] = json!(folder);
        }
        body
    };

    let (status, body) = create(job(None, false)).await;
    assert_eq!(
        (
            status,
            body["code"].as_str(),
            body["data"]["field"].as_str()
        ),
        (
            StatusCode::BAD_REQUEST,
            Some("request/invalid"),
            Some("folder")
        )
    );
    let (status, body) = create(job(Some("Not A Slug"), false)).await;
    assert_eq!(
        (
            status,
            body["code"].as_str(),
            body["data"]["field"].as_str()
        ),
        (
            StatusCode::BAD_REQUEST,
            Some("request/invalid"),
            Some("folder")
        )
    );

    let (status, first) = create(job(Some("people"), false)).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(first["folder"], "people");

    let (status, body) = create(job(Some("people"), false)).await;
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

    let (status, draft) = create(job(None, true)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(draft.get("folder").is_none());
    let path = format!("/v1/jobs/{}", draft["id"].as_str().unwrap());
    let (status, updated) = app
        .send(Method::PUT, &path, &member, json!({ "folder": "people" }))
        .await;
    assert_eq!(
        (status, updated["folder"].as_str()),
        (StatusCode::OK, Some("people"))
    );
    let (status, body) = app
        .send(Method::PUT, &path, &member, json!({ "folder": "-bad" }))
        .await;
    assert_eq!(
        (status, body["data"]["field"].as_str()),
        (StatusCode::BAD_REQUEST, Some("folder"))
    );
    let (status, _) = app
        .send(
            Method::PATCH,
            &path,
            &member,
            json!({ "status": "running" }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "a draft is never run");
}

/// A job's dashboard: none until saved, an object no larger than the cap, and
/// its owner's alone.
#[tokio::test]
async fn a_job_keeps_one_dashboard() {
    let app = spawn_app().await;
    let mine = app.token_for("u-1", &["member"]);
    let theirs = app.token_for("u-2", &["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let (_, job) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &mine,
            json!({ "script": "x", "draft": true, "sink_connection": "sink" }),
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

/// A job the bootstrap file declares for an email is held until the member
/// whose verified address it is lists their jobs; then it is theirs, ready to
/// run, and no later boot declares it again.
#[tokio::test]
async fn a_declared_job_goes_to_the_member_the_realm_vouches_for() {
    let app = spawn_app().await;
    app.credential("key", DEAD, "bootstrap").await;
    app.connection("sink", "key", Direction::Sink, "bootstrap")
        .await;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("graph.fossil"), "program").unwrap();
    let file = dir.path().join("bootstrap.json");
    std::fs::write(
        &file,
        json!({ "jobs": [{
            "name": "Seeded",
            "owner": "dev@keasy.local",
            "sink_connection": "sink",
            "folder": "seeded",
            "script_file": "graph.fossil",
        }] })
        .to_string(),
    )
    .unwrap();
    let boot = || keasy_server::bootstrap::ensure_declared(&app.db, file.to_str().unwrap());
    boot().await;
    boot().await;

    let token = |sub: &str, email: &str, verified: bool| {
        let mut claims = good(&app.realm);
        claims["sub"] = json!(sub);
        claims["email"] = json!(email);
        claims["email_verified"] = json!(verified);
        claims["resource_access"] = json!({ "keasy-ws-dev": { "roles": ["member"] } });
        mint(&app.realm, claims)
    };
    let app = &app;
    let list = |token: String| async move {
        app.send(Method::GET, "/v1/jobs", &token, json!(null))
            .await
            .1
    };

    assert_eq!(
        list(token("u-9", "dev@keasy.local", false)).await,
        json!([]),
        "an address the realm has not verified claims nothing"
    );

    let listed = list(token("u-1", "dev@keasy.local", true)).await;
    let listed = listed.as_array().unwrap();
    assert_eq!(listed.len(), 1, "declared once across two boots");
    assert_eq!(listed[0]["name"], "Seeded");
    assert_eq!(
        listed[0]["status"], "draft",
        "a draft: nothing sweeps it before anyone opens it"
    );
    assert_eq!(listed[0]["folder"], "seeded");
    assert_eq!(listed[0]["script"], "program");
    assert_eq!(listed[0]["created_by"], "u-1");

    boot().await;
    let listed = list(token("u-1", "dev@keasy.local", true)).await;
    assert_eq!(
        listed.as_array().unwrap().len(),
        1,
        "a claimed job is not declared again"
    );
    assert_eq!(
        list(token("u-2", "other@keasy.local", true)).await,
        json!([])
    );
}

/// A job's name is spelled as a connection's: a misspelled one is refused on
/// the field that holds it, on create and on edit.
#[tokio::test]
async fn a_misspelled_name_is_refused_on_its_field() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    for name in [" lead", "a/b", "@x", ""] {
        let (status, body) = app
            .send(
                Method::POST,
                "/v1/jobs",
                &member,
                json!({ "script": "x", "sink_connection": "sink", "draft": true, "name": name }),
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
            json!({ "script": "x", "sink_connection": "sink", "draft": true, "name": "People" }),
        )
        .await;
    assert_eq!(draft["name"], "People");
    let path = format!("/v1/jobs/{}", draft["id"].as_str().unwrap());
    let (status, body) = app
        .send(Method::PUT, &path, &member, json!({ "name": "trail " }))
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
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let (_, draft) = app
        .send(
            Method::POST,
            "/v1/jobs",
            &member,
            json!({ "script": "x", "sink_connection": "sink", "draft": true }),
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
    assert_ne!(job["created_at"], hour_ago);

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
    let theirs = app.token_for("u-2", &["member"]);
    let (status, _) = app.send(Method::POST, &submit, &theirs, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// A draft submitted onto a folder another job holds is refused on the
/// folder, and stays the draft it was.
#[tokio::test]
async fn submitting_onto_a_taken_folder_leaves_the_draft() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let create = |body: serde_json::Value| app.send(Method::POST, "/v1/jobs", &member, body);
    create(json!({ "script": "x", "sink_connection": "sink", "folder": "people" })).await;
    let (_, draft) = create(json!({
        "script": "x", "sink_connection": "sink", "draft": true, "name": "Mine",
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

/// Whether a folder of the sink is free: held only by a job that is not a
/// draft, and asked only of the sink.
#[tokio::test]
async fn a_folder_is_available_until_a_job_to_run_holds_it() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("source", "key", Direction::Source, "u-1")
        .await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let ask = |path: &'static str| app.send(Method::GET, path, &member, json!(null));
    let create = |body: serde_json::Value| app.send(Method::POST, "/v1/jobs", &member, body);

    create(json!({ "script": "x", "sink_connection": "sink", "draft": true, "folder": "people" }))
        .await;
    assert_eq!(
        ask("/v1/connections/sink/folders/people").await,
        (StatusCode::OK, json!({ "available": true }))
    );
    create(json!({ "script": "x", "sink_connection": "sink", "folder": "people" })).await;
    assert_eq!(
        ask("/v1/connections/sink/folders/people").await,
        (StatusCode::OK, json!({ "available": false }))
    );

    let (status, body) = ask("/v1/connections/sink/folders/Not-A-Slug").await;
    assert_eq!(
        (
            status,
            body["code"].as_str(),
            body["data"]["field"].as_str()
        ),
        (
            StatusCode::BAD_REQUEST,
            Some("request/invalid"),
            Some("folder")
        )
    );
    let (status, body) = ask("/v1/connections/source/folders/people").await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::BAD_REQUEST, Some("job/invalid-destination"))
    );
    let (status, body) = ask("/v1/connections/gone/folders/people").await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::NOT_FOUND, Some("connection/not-found"))
    );
}

/// A run moves forward only: from running it reports running again, or one of
/// its ends, and every end is dated. Never back to a draft or to pending.
#[tokio::test]
async fn a_run_reports_forward_and_every_end_is_dated() {
    let app = spawn_app().await;
    let member = app.token(&["member"]);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    for (n, target) in ["completed", "failed", "cancelled", "draft", "pending"]
        .into_iter()
        .enumerate()
    {
        let (_, job) = app
            .send(
                Method::POST,
                "/v1/jobs",
                &member,
                json!({ "script": "x", "sink_connection": "sink", "folder": format!("out-{n}") }),
            )
            .await;
        let path = format!("/v1/jobs/{}", job["id"].as_str().unwrap());
        let report =
            |status: &str| app.send(Method::PATCH, &path, &member, json!({ "status": status }));
        let (status, running) = report("running").await;
        assert_eq!(
            (status, running["status"].as_str()),
            (StatusCode::OK, Some("running"))
        );
        assert!(running.get("completed_at").is_none());

        let (status, body) = report(target).await;
        match target {
            "draft" | "pending" => {
                assert_eq!(status, StatusCode::BAD_REQUEST, "running → {target}");
                let (_, read) = app.send(Method::GET, &path, &member, json!(null)).await;
                assert_eq!(read["status"], "running", "running → {target}");
            }
            ended => {
                assert_eq!(status, StatusCode::OK, "running → {ended}");
                assert_eq!(body["status"], ended);
                assert!(body["completed_at"].is_string(), "{ended} is dated");
            }
        }
    }
}
