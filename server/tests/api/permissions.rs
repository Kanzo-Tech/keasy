//! The permission matrix (`docs/design/permissions.md`) cell by cell, where a
//! cell turns on the object rather than the route: who owns it, and whether it
//! is the sink. What turns on the route alone is `authorization.rs`.

use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{ADMIN, EDITOR, Options, READER, TestApp, fake_s3, spawn_app, spawn_app_with};
use keasy_server::domain::Direction;

/// A workspace whose store answers, with a secret and a source the instance
/// declared — owned by the workspace, as the seeded ones are.
async fn seeded() -> TestApp {
    let app = spawn_app_with(Options {
        store: fake_s3().await,
        ..Options::default()
    })
    .await;
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(
        file.path(),
        json!({
            "secrets": [{ "name": "seed", "spec": {
                "kind": "s3", "access_key_id": "AK", "secret_access_key": "s"
            }}],
            "connections": [{ "name": "data", "secret": "seed",
                              "target": { "url": "s3://b/data/" } }],
        })
        .to_string(),
    )
    .unwrap();
    keasy_server::bootstrap::ensure_declared(
        &app.db,
        file.path().to_str().unwrap(),
        &app.endpoints,
    )
    .await;
    app
}

/// Testing operates a connection or a secret, it does not change it: any
/// editor tests what the workspace owns, the report names them, and the
/// resource is not marked as updated by them. Changing it stays an admin's.
#[tokio::test]
async fn an_editor_tests_what_the_workspace_owns_and_the_report_names_them() {
    let app = seeded().await;
    let editor = app.token_profiled("u-2", EDITOR, json!({ "name": "Bruno" }));

    for (resource, path) in [
        ("connection", "/v1/connections/data"),
        ("secret", "/v1/secrets/seed"),
    ] {
        let (status, before) = app.send(Method::GET, path, &editor, json!(null)).await;
        assert_eq!(status, StatusCode::OK, "{before}");
        assert_eq!(before["owner"]["id"], "workspace", "{resource}");
        assert_eq!(
            before["can"],
            json!({ "operate": true, "manage": false }),
            "{resource}"
        );

        let (status, report) = app
            .send(
                Method::POST,
                &format!("{path}/validate"),
                &editor,
                json!(null),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{resource}: {report}");
        assert_eq!(
            report["by"],
            json!({ "id": "u-2", "name": "Bruno" }),
            "{resource}"
        );

        let (_, after) = app.send(Method::GET, path, &editor, json!(null)).await;
        assert_eq!(after["validation"]["by"]["id"], "u-2", "{resource}");
        assert!(
            after.get("updated_by").is_none(),
            "{resource}: a test is not an update: {after}"
        );

        let (status, body) = app
            .send(Method::PATCH, path, &editor, json!({ "name": "renamed" }))
            .await;
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
            "{resource}: the workspace's is an admin's to change"
        );
    }

    let admin = app.token_for("u-9", ADMIN);
    let (status, renamed) = app
        .send(
            Method::PATCH,
            "/v1/connections/data",
            &admin,
            json!({ "name": "people" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(
        renamed["owner"]["id"], "workspace",
        "a change keeps the owner"
    );
}

/// What lies under a source is used, not read: an editor lists it, a reader
/// is refused, as a reader is refused a credential to read it.
#[tokio::test]
async fn a_reader_is_refused_a_sources_files() {
    let app = seeded().await;
    let reader = app.token_for("u-3", READER);
    let editor = app.token_for("u-2", EDITOR);

    let (status, body) = app
        .send(
            Method::GET,
            "/v1/connections/data/files",
            &reader,
            json!(null),
        )
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/insufficient-role"))
    );
    let (status, body) = app
        .send(
            Method::GET,
            "/v1/connections/data/files",
            &editor,
            json!(null),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, connection) = app
        .send(Method::GET, "/v1/connections/data", &reader, json!(null))
        .await;
    assert_eq!(status, StatusCode::OK, "a reader still sees the connection");
    assert_eq!(
        connection["can"],
        json!({ "operate": false, "manage": false })
    );
}

/// Running is operating: another editor runs, and runs again, a graph they do
/// not own, without taking it. Stopping that run is its runner's, the owner's
/// or an admin's — not a third editor's.
#[tokio::test]
async fn an_editor_reruns_anothers_graph_and_its_owner_may_stop_it() {
    let app = spawn_app().await;
    let owner = app.token_for("u-1", EDITOR);
    let runner = app.token_for("u-2", EDITOR);
    let bystander = app.token_for("u-3", EDITOR);
    app.credential("key", "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let id = app.submitted(&owner).await;

    let (status, graph) = app.run(&runner, &id).await;
    assert_eq!(status, StatusCode::OK, "{graph}");
    assert_eq!(
        (
            graph["runner"]["id"].as_str(),
            graph["owner"]["id"].as_str()
        ),
        (Some("u-2"), Some("u-1"))
    );
    assert_eq!(graph["can"], json!({ "operate": true, "manage": false }));

    let stop_path = format!("/v1/graphs/{id}/stop");
    let (status, body) = app
        .send(Method::POST, &stop_path, &bystander, json!(null))
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden"))
    );
    let (_, seen) = app
        .send(
            Method::GET,
            &format!("/v1/graphs/{id}"),
            &owner,
            json!(null),
        )
        .await;
    assert_eq!(seen["can_stop"], true, "the owner may stop another's run");
    let (status, stopping) = app
        .send(Method::POST, &stop_path, &owner, json!(null))
        .await;
    assert_eq!(
        (status, stopping["cancel_requested"].as_bool()),
        (StatusCode::OK, Some(true))
    );
    let (status, _) = app
        .report(&runner, &id, json!({ "status": "cancelled" }))
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, again) = app.run(&bystander, &id).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["runner"]["id"], "u-3", "run again by a third editor");
}

/// Phase A keeps using a secret open to every editor: a connection on another
/// person's secret is made. Phase B asks for a grant here, and only here.
#[tokio::test]
async fn an_editor_uses_anothers_secret_until_grants_arrive() {
    let app = seeded().await;
    let editor = app.token_for("u-2", EDITOR);
    let (status, body) = app
        .send(
            Method::POST,
            "/v1/connections",
            &editor,
            json!({ "name": "more", "secret": "seed", "target": { "url": "s3://b/more/" } }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["owner"]["id"], "u-2", "who makes a connection owns it");
    assert_eq!(body["validation"]["by"]["id"], "u-2");
    assert_eq!(body["can"], json!({ "operate": true, "manage": true }));
}
