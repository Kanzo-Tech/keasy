use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{ADMIN, DEAD, EDITOR, READER, spawn_app};
use keasy_server::domain::Direction;

/// A graph needs a destination, and it must be the sink.
#[tokio::test]
async fn a_graph_goes_to_the_sink_or_is_refused() {
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
        app.send(Method::POST, "/v1/graphs", &member, body)
    };

    assert_eq!(create(None).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, body) = create(Some("source")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "graph/invalid-destination");
    assert_eq!(create(Some("gone")).await.0, StatusCode::BAD_REQUEST);
    let (status, graph) = create(Some("sink")).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(graph["sink_connection"], json!("sink"));
}

/// The work in a workspace is shared: everyone lists and reads a graph. Its
/// creator or an admin changes, runs and deletes it; another editor is refused
/// with `rbac/forbidden` — the graph exists for them, it is not theirs to change.
#[tokio::test]
async fn a_graph_is_read_by_all_and_changed_by_its_creator_or_an_admin() {
    let app = spawn_app().await;
    let mine = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    let reader = app.token_for("u-3", READER);
    let admin = app.token_for("u-9", ADMIN);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let (_, graph) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &mine,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    assert_eq!(graph["can_modify"], true);
    let id = graph["id"].as_str().unwrap().to_string();
    let path = format!("/v1/graphs/{id}");

    for (who, token, can_modify) in [
        ("another editor", &theirs, false),
        ("a reader", &reader, false),
        ("an admin", &admin, true),
    ] {
        let (_, listed) = app
            .send(Method::GET, "/v1/graphs", token, json!(null))
            .await;
        assert_eq!(listed.as_array().unwrap().len(), 1, "{who} lists it");
        assert_eq!(listed[0]["can_modify"], can_modify, "{who}");
        let (status, read) = app.send(Method::GET, &path, token, json!(null)).await;
        assert_eq!(
            (status, read["can_modify"].as_bool()),
            (StatusCode::OK, Some(can_modify)),
            "{who}"
        );
    }

    for (verb, route, body) in [
        (Method::PATCH, path.clone(), json!({ "name": "stolen" })),
        (
            Method::POST,
            format!("{path}/submit"),
            json!({ "folder": "f" }),
        ),
        (Method::POST, format!("{path}/run"), json!(null)),
        (Method::DELETE, path.clone(), json!(null)),
    ] {
        let (status, body) = app.send(verb.clone(), &route, &theirs, body).await;
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
            "{verb} {route}"
        );
    }

    let (status, edited) = app
        .send(Method::PATCH, &path, &admin, json!({ "name": "renamed" }))
        .await;
    assert_eq!(
        (status, edited["name"].as_str()),
        (StatusCode::OK, Some("renamed"))
    );
    assert_eq!(
        edited["created_by"]["id"], "u-1",
        "an admin's edit keeps who made it"
    );
}

/// A failed run keeps the problem the browser reported, whole: the web
/// branches on its `code` and reads its `data`, so a string would lose both.
#[tokio::test]
async fn a_failed_run_keeps_its_problem_whole() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let id = app.running(&member).await;
    let path = format!("/v1/graphs/{id}");
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
    assert_eq!(status, StatusCode::OK);
    assert_eq!(failed["problem"], problem);
    let (_, read) = app.send(Method::GET, &path, &member, json!(null)).await;
    assert_eq!(read["problem"], problem);
}

/// A graph to run names a folder no other graph in the sink writes to; a draft
/// may go without, and is never run.
#[tokio::test]
async fn a_graph_writes_to_a_folder_of_its_own() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let draft = |folder: Option<&str>| {
        let mut body = json!({ "script": "x", "sink_connection": "sink" });
        if let Some(folder) = folder {
            body["folder"] = json!(folder);
        }
        app.send(Method::POST, "/v1/graphs", &member, body)
    };
    let submit = |id: String, body: serde_json::Value| {
        let member = member.clone();
        let app = &app;
        async move {
            app.send(
                Method::POST,
                &format!("/v1/graphs/{id}/submit"),
                &member,
                body,
            )
            .await
        }
    };
    let id = |graph: &serde_json::Value| graph["id"].as_str().unwrap().to_string();
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
    assert_eq!(unfiled["status"], "draft", "a graph begins as a draft");
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
        (StatusCode::OK, Some("people"))
    );
    let (_, second) = draft(Some("people")).await;
    assert_eq!(
        refused_on(submit(id(&second), json!({})).await),
        on_folder(StatusCode::CONFLICT, "graph/folder-taken")
    );

    let path = format!("/v1/graphs/{}", id(&unfiled));
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
            &format!("/v1/graphs/{}", id(&first)),
            &member,
            json!({ "name": "late" }),
        )
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::CONFLICT, Some("graph/not-draft")),
        "a submitted graph is not edited"
    );
}

/// A graph's dashboard: none until saved, an object no larger than the cap, and
/// its owner's alone.
#[tokio::test]
async fn a_graph_keeps_one_dashboard() {
    let app = spawn_app().await;
    let mine = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let (_, graph) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &mine,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let path = format!("/v1/graphs/{}/dashboard", graph["id"].as_str().unwrap());

    let (status, body) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!((status, body), (StatusCode::OK, json!(null)));

    for spec in [json!([1]), json!("x"), json!(null)] {
        let (status, _) = app
            .send(Method::PUT, &path, &mine, json!({ "spec": spec }))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{spec}");
    }
    let huge = "x".repeat(keasy_server::routes::graphs::dashboard::MAX_SPEC_BYTES);
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
    assert_eq!(saved["created_by"]["id"], "u-1");
    let (_, read) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(read["spec"], spec);

    let (status, read) = app.send(Method::GET, &path, &theirs, json!(null)).await;
    assert_eq!(
        (status, &read["spec"]),
        (StatusCode::OK, &spec),
        "everyone reads it"
    );
    let (status, body) = app
        .send(Method::PUT, &path, &theirs, json!({ "spec": {} }))
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
        "only who may change the graph saves its dashboard"
    );
}

/// A graph's rules: none until saved, a Turtle file no larger than the cap
/// that rudof reads as a shapes graph, stored as sent under its file's name,
/// and its owner's alone.
#[tokio::test]
async fn a_graph_keeps_one_shapes_graph_of_rules() {
    let app = spawn_app().await;
    let mine = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let (_, graph) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &mine,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let path = format!("/v1/graphs/{}/rules", graph["id"].as_str().unwrap());

    let (status, body) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!((status, body), (StatusCode::OK, json!(null)));
    let (status, _) = app
        .send(
            Method::GET,
            "/v1/graphs/no-such-graph/rules",
            &mine,
            json!(null),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    for body in [
        json!({ "name": "r.ttl", "shapes": { "a": 1 } }),
        json!({ "name": "r.ttl", "shapes": null }),
        json!({ "shapes": "" }),
        json!({}),
    ] {
        let (status, _) = app.send(Method::PUT, &path, &mine, body.clone()).await;
        assert!(status.is_client_error(), "{body}: {status}");
        assert_ne!(status, StatusCode::FORBIDDEN, "{body}");
    }
    let huge = "#".repeat(keasy_server::routes::graphs::rules::MAX_SHAPES_BYTES + 1);
    let (status, _) = app
        .send(
            Method::PUT,
            &path,
            &mine,
            json!({ "name": "r.ttl", "shapes": huge }),
        )
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

    let (status, body) = app
        .send(
            Method::PUT,
            &path,
            &mine,
            json!({ "name": "r.ttl", "shapes": "@prefix sh: <http://www.w3.org/ns/shacl#> .\n<#S> a sh:NodeShape ;\n  sh:path .\n" }),
        )
        .await;
    assert_eq!(
        (
            status,
            body["code"].as_str(),
            body["data"]["field"].as_str(),
            &body["data"]["line"],
            &body["data"]["column"],
        ),
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Some("rules/refused"),
            Some("shapes"),
            &json!(3),
            &json!(11),
        ),
        "Turtle that does not parse is refused where the parser stopped: {body}"
    );
    let (status, body) = app
        .send(
            Method::PUT,
            &path,
            &mine,
            json!({ "name": "r.ttl", "shapes": "@prefix sh: <http://www.w3.org/ns/shacl#> .\n<#S> a sh:NodeShape ; sh:minCount \"x\" .\n" }),
        )
        .await;
    assert_eq!(
        (status, body["code"].as_str(), &body["data"]["line"]),
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Some("rules/refused"),
            &json!(null)
        ),
        "Turtle that is not a SHACL shapes graph is refused, with no place: {body}"
    );

    let shapes = "@prefix sh: <http://www.w3.org/ns/shacl#> .\n\n\
                  <#Person> a sh:NodeShape ;\n  sh:property [ sh:path <#age> ; sh:minCount 1 ] .\n";
    for name in ["", "a/b.ttl", "..\\b.ttl", "a\nb.ttl", &"x".repeat(256)] {
        let (status, body) = app
            .send(
                Method::PUT,
                &path,
                &mine,
                json!({ "name": name, "shapes": shapes }),
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
            "{name:?} is not a file's name: {body}"
        );
    }
    let (_, read) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(read, json!(null), "a refused file leaves nothing behind");

    let (status, saved) = app
        .send(
            Method::PUT,
            &path,
            &mine,
            json!({ "name": "ldbc-quality.ttl", "shapes": shapes }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["created_by"]["id"], "u-1");
    let (_, read) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(
        (&read["name"], &read["shapes"]),
        (&json!("ldbc-quality.ttl"), &json!(shapes)),
        "stored as sent, under its file's name"
    );

    let (status, body) = app
        .send(
            Method::PUT,
            &path,
            &mine,
            json!({ "name": "ldbc-quality-v2.ttl", "shapes": "<#S> a ;" }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (_, read) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(
        read["name"], "ldbc-quality.ttl",
        "a file rudof refuses leaves the previous one in place"
    );

    let (status, read) = app.send(Method::GET, &path, &theirs, json!(null)).await;
    assert_eq!(
        (status, read["shapes"].as_str()),
        (StatusCode::OK, Some(shapes)),
        "everyone reads them"
    );
    let (status, body) = app
        .send(
            Method::PUT,
            &path,
            &theirs,
            json!({ "name": "r.ttl", "shapes": "" }),
        )
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
        "only who may change the graph saves its rules"
    );
}

/// A graph's name is spelled as a connection's: a misspelled one is refused on
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
                "/v1/graphs",
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
            "/v1/graphs",
            &member,
            json!({ "script": "x", "sink_connection": "sink", "name": "People" }),
        )
        .await;
    assert_eq!(draft["name"], "People");
    let path = format!("/v1/graphs/{}", draft["id"].as_str().unwrap());
    let (status, body) = app
        .send(Method::PATCH, &path, &member, json!({ "name": "trail " }))
        .await;
    assert_eq!(
        (status, body["data"]["field"].as_str()),
        (StatusCode::BAD_REQUEST, Some("name"))
    );
}

/// Submitting turns the draft into the graph to run in place: the same id, one
/// graph listed, idle — nothing runs it until someone does, and nothing sweeps
/// it while it waits.
#[tokio::test]
async fn submitting_a_draft_makes_it_the_graph_in_place() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let (_, draft) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &member,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let id = draft["id"].as_str().unwrap().to_string();
    let hour_ago = "2000-01-01T00:00:00Z";
    app.db
        .write()
        .await
        .execute("UPDATE graphs SET created_at = ?1", [hour_ago])
        .unwrap();
    let submit = format!("/v1/graphs/{id}/submit");

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

    let (status, graph) = app
        .send(
            Method::POST,
            &submit,
            &member,
            json!({ "script": "y", "name": "People", "folder": "people" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(graph["id"], json!(id));
    assert_eq!(graph["status"], "idle");
    assert_eq!(
        (graph["script"].as_str(), graph["name"].as_str()),
        (Some("y"), Some("People"))
    );
    assert_eq!(
        graph["created_at"], hour_ago,
        "a graph is dated when it was made"
    );
    assert!(
        graph.get("heartbeat_at").is_none(),
        "no lease: nothing runs it"
    );
    assert!(graph.get("runner").is_none());

    let (_, listed) = app
        .send(Method::GET, "/v1/graphs", &member, json!(null))
        .await;
    let listed = listed.as_array().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0]["id"].as_str(), listed[0]["status"].as_str()),
        (Some(&*id), Some("idle"))
    );

    let (status, body) = app.send(Method::POST, &submit, &member, json!({})).await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::CONFLICT, Some("graph/not-draft"))
    );
    let theirs = app.token_for("u-2", EDITOR);
    let (status, _) = app.send(Method::POST, &submit, &theirs, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// A draft submitted onto a folder another graph holds is refused on the
/// folder, and stays the draft it was.
#[tokio::test]
async fn submitting_onto_a_taken_folder_leaves_the_draft() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let create = |body: serde_json::Value| app.send(Method::POST, "/v1/graphs", &member, body);
    let (_, held) =
        create(json!({ "script": "x", "sink_connection": "sink", "folder": "people" })).await;
    let held = format!("/v1/graphs/{}/submit", held["id"].as_str().unwrap());
    app.send(Method::POST, &held, &member, json!({})).await;
    let (_, draft) = create(json!({
        "script": "x", "sink_connection": "sink", "name": "Mine",
    }))
    .await;
    let path = format!("/v1/graphs/{}", draft["id"].as_str().unwrap());

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
            Some("graph/folder-taken"),
            Some("folder")
        )
    );
    let (_, read) = app.send(Method::GET, &path, &member, json!(null)).await;
    assert_eq!(read["status"], "draft");
    assert_eq!(read["name"], "Mine");
    assert!(read.get("folder").is_none());
}

/// A run moves forward only: from running it reports running again, or one of
/// its ends, and every end is dated. Never back to a draft or to idle.
#[tokio::test]
async fn a_run_reports_forward_and_every_end_is_dated() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    for target in ["completed", "failed", "cancelled", "draft", "idle"] {
        let id = app.running(&member).await;
        let report = |status: &str| app.report(&member, &id, json!({ "status": status }));
        let (status, running) = report("running").await;
        assert_eq!(
            (status, running["status"].as_str()),
            (StatusCode::OK, Some("running"))
        );
        assert!(running.get("completed_at").is_none());

        let (status, body) = report(target).await;
        match target {
            "draft" | "idle" => {
                assert_eq!(status, StatusCode::BAD_REQUEST, "running → {target}");
                let (_, read) = app
                    .send(
                        Method::GET,
                        &format!("/v1/graphs/{id}"),
                        &member,
                        json!(null),
                    )
                    .await;
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

/// Running is asked for, once: the caller becomes the runner, and of two runs
/// asked at once one starts and the other is `graph/already-running`. A draft
/// is submitted before it runs; a graph is run by who may change it.
#[tokio::test]
async fn a_graph_runs_once_at_a_time_for_whoever_started_it() {
    let app = spawn_app().await;
    let mine = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    let admin = app.token_for("u-9", ADMIN);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    let (_, draft) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &mine,
            json!({ "script": "x", "sink_connection": "sink", "folder": "f" }),
        )
        .await;
    assert_eq!(
        app.run(&mine, draft["id"].as_str().unwrap()).await.0,
        StatusCode::BAD_REQUEST,
        "a draft is submitted first"
    );

    let id = app.submitted(&mine).await;
    let (status, body) = app.run(&theirs, &id).await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden"))
    );

    let ((first, a), (second, b)) = tokio::join!(app.run(&mine, &id), app.run(&admin, &id));
    let mut answers = [(first, a), (second, b)];
    answers.sort_by_key(|(status, _)| *status);
    assert_eq!(answers[0].0, StatusCode::OK, "{:?}", answers);
    assert_eq!(
        (answers[1].0, answers[1].1["code"].as_str()),
        (StatusCode::CONFLICT, Some("graph/already-running"))
    );
    let started = &answers[0].1;
    assert_eq!(started["status"], "running");
    assert!(started["runner"]["id"] == "u-1" || started["runner"]["id"] == "u-9");
    assert_eq!(started["can_stop"], true, "the runner may stop its run");
}

/// Only the runner reports on a run — not its creator, not an admin — and
/// only the runner is vended its output to write.
#[tokio::test]
async fn only_the_runner_reports_and_writes() {
    let app = spawn_app().await;
    let creator = app.token_for("u-1", EDITOR);
    let admin = app.token_for("u-9", ADMIN);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let id = app.submitted(&creator).await;
    let (status, _) = app.run(&admin, &id).await;
    assert_eq!(status, StatusCode::OK, "an admin runs anyone's graph");

    let (status, body) = app
        .report(&creator, &id, json!({ "status": "completed" }))
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
        "the creator is not the runner"
    );
    assert_eq!(
        app.vend(&creator, json!({ "job": id }), "write").await,
        (StatusCode::FORBIDDEN, Some("rbac/forbidden".to_owned()))
    );
    assert_eq!(
        app.vend(&admin, json!({ "job": id }), "write").await.0,
        StatusCode::BAD_GATEWAY,
        "the runner is vended, refused only by the dead store"
    );
    let (status, body) = app
        .report(&admin, &id, json!({ "status": "completed" }))
        .await;
    assert_eq!(
        (status, body["status"].as_str()),
        (StatusCode::OK, Some("completed"))
    );
}

/// Stop is cooperative: its runner or an admin asks it, the runner hears it in
/// the answer to its next report and ends the run cancelled. Another editor
/// may not ask.
#[tokio::test]
async fn a_run_is_stopped_by_its_runner_or_an_admin_through_its_runner() {
    let app = spawn_app().await;
    let runner = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    let admin = app.token_for("u-9", ADMIN);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let beat = |id: String| {
        let runner = runner.clone();
        let app = &app;
        async move {
            app.send(
                Method::POST,
                &format!("/v1/graphs/{id}/status"),
                &runner,
                json!({ "status": "running" }),
            )
            .await
        }
    };
    let stop = |token: String, id: String| {
        let app = &app;
        async move {
            app.send(
                Method::POST,
                &format!("/v1/graphs/{id}/stop"),
                &token,
                json!(null),
            )
            .await
        }
    };

    for (who, token) in [("its runner", &runner), ("an admin", &admin)] {
        let id = app.running(&runner).await;
        assert_eq!(beat(id.clone()).await.1["cancel_requested"], false, "{who}");

        let (status, body) = stop(theirs.clone(), id.clone()).await;
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
            "another editor, before {who}"
        );
        let (status, stopping) = stop(token.clone(), id.clone()).await;
        assert_eq!(
            (
                status,
                stopping["status"].as_str(),
                stopping["cancel_requested"].as_bool()
            ),
            (StatusCode::OK, Some("running"), Some(true)),
            "{who} asks; the run goes on until its runner hears it"
        );
        assert_eq!(beat(id.clone()).await.1["cancel_requested"], true, "{who}");

        let (status, ended) = app
            .report(&runner, &id, json!({ "status": "cancelled" }))
            .await;
        assert_eq!(
            (
                status,
                ended["status"].as_str(),
                ended["cancel_requested"].as_bool()
            ),
            (StatusCode::OK, Some("cancelled"), Some(false)),
            "{who}"
        );
        let (status, body) = stop(token.clone(), id.clone()).await;
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::CONFLICT, Some("graph/ended"))
        );
    }
}

/// Running again re-runs a graph that ended, in the same folder: the last run's
/// report and end go, and the output is written over.
#[tokio::test]
async fn running_again_writes_over_the_last_output() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let id = app.running(&member).await;
    let (_, done) = app
        .report(
            &member,
            &id,
            json!({ "status": "completed", "report": { "dest": "d" } }),
        )
        .await;
    assert_eq!(done["report"], json!({ "dest": "d" }));

    let (status, again) = app.run(&member, &id).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["status"], "running");
    assert_eq!(again["folder"], done["folder"], "the same folder");
    assert_eq!(again["output"], done["output"]);
    assert!(again.get("report").is_none() && again.get("completed_at").is_none());
    assert_eq!(
        app.vend(&member, json!({ "job": id }), "write").await.0,
        StatusCode::BAD_GATEWAY,
        "its runner writes the folder again"
    );
}

/// Every graph says where its output lands, as the sink's URL spells it.
#[tokio::test]
async fn a_graph_says_where_its_output_lands() {
    let app = spawn_app().await;
    let member = app.token(EDITOR);
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let id = app.submitted(&member).await;
    let (_, graph) = app
        .send(
            Method::GET,
            &format!("/v1/graphs/{id}"),
            &member,
            json!(null),
        )
        .await;
    let output = graph["output"].as_str().unwrap();
    assert!(
        output.ends_with(&format!("/{}/", graph["folder"].as_str().unwrap())),
        "{output}"
    );
    let (_, listed) = app
        .send(Method::GET, "/v1/graphs", &member, json!(null))
        .await;
    assert_eq!(listed[0]["output"], graph["output"]);
}
