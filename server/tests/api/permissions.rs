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
            json!({ "use": true, "operate": true, "manage": false, "transfer": false }),
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
        json!({ "use": false, "operate": false, "manage": false, "transfer": false })
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
    assert_eq!(
        graph["can"],
        json!({ "use": true, "operate": true, "manage": false, "transfer": false })
    );

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

/// What the workspace owns, every editor uses: a connection on a seeded
/// secret needs no grant, and who makes it owns it.
#[tokio::test]
async fn an_editor_builds_on_a_secret_the_workspace_owns() {
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
    assert_eq!(
        body["can"],
        json!({ "use": true, "operate": true, "manage": true, "transfer": true })
    );
}

/// A workspace whose store answers, with a secret `key` that `u-1` owns.
async fn owned_secret() -> TestApp {
    let app = spawn_app_with(Options {
        store: fake_s3().await,
        ..Options::default()
    })
    .await;
    let owner = app.token_for("u-1", EDITOR);
    let (status, body) = app
        .send(
            Method::POST,
            "/v1/secrets",
            &owner,
            json!({ "name": "key", "spec": {
                "kind": "s3", "access_key_id": "AK", "secret_access_key": "s"
            }}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    app
}

async fn connect(app: &TestApp, token: &str, name: &str) -> (StatusCode, serde_json::Value) {
    app.send(
        Method::POST,
        "/v1/connections",
        token,
        json!({ "name": name, "secret": "key", "target": { "url": format!("s3://b/{name}/") } }),
    )
    .await
}

/// Unity Catalog's rule for a storage credential: another person's secret is
/// used by a grant — to the editor, or to a group they are in — and the
/// refusal says whom to ask. A grant revoked is a connection refused again;
/// the connections already made on it stay.
#[tokio::test]
async fn using_anothers_secret_takes_a_grant_to_them_or_their_group() {
    let app = owned_secret().await;
    let owner = app.token_for("u-1", EDITOR);
    let bruno = app.token_for("u-2", EDITOR);
    let caro = app.token_grouped("u-3", EDITOR, &["g-data"]);

    let (_, secret) = app
        .send(Method::GET, "/v1/secrets/key", &bruno, json!(null))
        .await;
    assert_eq!(secret["can"]["use"], false, "{secret}");
    let (status, body) = connect(&app, &bruno, "denied").await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
        "{body}"
    );
    assert!(
        body["detail"].as_str().unwrap().contains("ask its owner"),
        "{body}"
    );

    let (status, shared) = app
        .send(
            Method::PUT,
            "/v1/secrets/key/grants",
            &owner,
            json!({ "grants": [
                { "principal": { "kind": "user", "id": "u-2", "name": "Bruno" }, "relation": "user" },
                { "principal": { "kind": "group", "id": "g-data", "name": "Data" }, "relation": "user" },
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{shared}");
    assert_eq!(
        shared["grants"][1]["principal"],
        json!({ "kind": "group", "id": "g-data", "name": "Data" }),
        "by name: Bruno, then Data"
    );
    assert_eq!(shared["grants"][1]["granted_by"]["id"], "u-1");
    for (who, token, name) in [("Bruno", &bruno, "bruno"), ("Data's Caro", &caro, "caro")] {
        let (status, body) = connect(&app, token, name).await;
        assert_eq!(status, StatusCode::CREATED, "{who}: {body}");
    }
    let (_, secret) = app
        .send(Method::GET, "/v1/secrets/key", &bruno, json!(null))
        .await;
    assert_eq!(
        secret["can"],
        json!({ "use": true, "operate": true, "manage": false, "transfer": false }),
        "a user uses it and changes nothing"
    );

    let (status, _) = app
        .send(
            Method::PUT,
            "/v1/secrets/key/grants",
            &owner,
            json!({ "grants": [] }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = connect(&app, &bruno, "again").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "revoked");
    let (status, kept) = app
        .send(Method::GET, "/v1/connections/bruno", &bruno, json!(null))
        .await;
    assert_eq!(
        (status, kept["secret"].as_str()),
        (StatusCode::OK, Some("key"))
    );
}

/// A manager — named, or through a group — changes and shares what they
/// manage, and does not give it away; a reader granted manager is still a
/// reader. Shared means listed: everyone who reads it sees with whom.
#[tokio::test]
async fn a_manager_changes_and_shares_and_does_not_transfer() {
    let app = owned_secret().await;
    let owner = app.token_for("u-1", EDITOR);
    let (status, _) = connect(&app, &owner, "data").await;
    assert_eq!(status, StatusCode::CREATED);
    let manager = app.token_grouped("u-2", EDITOR, &["g-research"]);
    let reader = app.token_for("u-4", READER);

    let (status, shared) = app
        .send(
            Method::PUT,
            "/v1/connections/data/grants",
            &owner,
            json!({ "grants": [
                { "principal": { "kind": "group", "id": "g-research", "name": "Research" }, "relation": "manager" },
                { "principal": { "kind": "user", "id": "u-4", "name": "Dani" }, "relation": "manager" },
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{shared}");

    let (_, seen) = app
        .send(Method::GET, "/v1/connections/data", &manager, json!(null))
        .await;
    assert_eq!(
        seen["can"],
        json!({ "use": true, "operate": true, "manage": true, "transfer": false })
    );
    let (_, listed) = app
        .send(Method::GET, "/v1/connections", &reader, json!(null))
        .await;
    assert_eq!(listed[0]["grants"].as_array().unwrap().len(), 2, "{listed}");
    assert_eq!(
        listed[0]["can"]["manage"], false,
        "a grant raises no reader"
    );

    let (status, reshared) = app
        .send(
            Method::PUT,
            "/v1/connections/data/grants",
            &manager,
            json!({ "grants": [
                { "principal": { "kind": "group", "id": "g-research", "name": "Research" }, "relation": "manager" },
                { "principal": { "kind": "user", "id": "u-5", "name": "Eli" }, "relation": "manager" },
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "a manager shares: {reshared}");
    assert_eq!(
        reshared["grants"][0]["principal"]["id"], "u-5",
        "by name: Eli, then Research"
    );
    let (status, renamed) = app
        .send(
            Method::PATCH,
            "/v1/connections/data",
            &manager,
            json!({ "name": "ours" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "a manager changes it: {renamed}");
    assert_eq!(
        renamed["grants"].as_array().unwrap().len(),
        2,
        "the grants go with the rename"
    );

    let (status, body) = app
        .send(
            Method::PUT,
            "/v1/connections/ours/owner",
            &manager,
            json!({ "owner": { "id": "u-2", "name": "Bruno" } }),
        )
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
        "{body}"
    );
}

/// The owner gives a graph away and keeps nothing by having owned it; an
/// admin gives anything to the workspace. The sink is the workspace's: never
/// shared, never given.
#[tokio::test]
async fn the_owner_or_an_admin_transfers_and_the_sink_stays_the_workspaces() {
    let app = seeded().await;
    let owner = app.token_for("u-1", EDITOR);
    let bruno = app.token_for("u-2", EDITOR);
    let admin = app.token_for("u-9", ADMIN);
    app.connection("sink", "seed", Direction::Sink, "bootstrap")
        .await;
    let (_, graph) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &owner,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let path = format!("/v1/graphs/{}", graph["id"].as_str().unwrap());

    let (status, given) = app
        .send(
            Method::PUT,
            &format!("{path}/owner"),
            &owner,
            json!({ "owner": { "id": "u-2", "name": " Bruno " } }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{given}");
    assert_eq!(given["owner"], json!({ "id": "u-2", "name": "Bruno" }));
    assert_eq!(
        given["created_by"]["id"], "u-1",
        "who created it never changes"
    );
    assert_eq!(given["can"]["manage"], false, "the old owner keeps nothing");
    let (_, theirs) = app.send(Method::GET, &path, &bruno, json!(null)).await;
    assert_eq!(theirs["can"]["transfer"], true);

    let (status, workspace) = app
        .send(
            Method::PUT,
            &format!("{path}/owner"),
            &admin,
            json!({ "owner": { "id": "workspace" } }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{workspace}");
    assert_eq!(
        workspace["owner"],
        json!({ "id": "workspace", "name": "Workspace" })
    );

    for (verb, route, body, code) in [
        (
            "share",
            "/v1/connections/sink/grants",
            json!({ "grants": [{ "principal": { "kind": "user", "id": "u-2", "name": "Bruno" }, "relation": "manager" }] }),
            StatusCode::BAD_REQUEST,
        ),
        (
            "transfer",
            "/v1/connections/sink/owner",
            json!({ "owner": { "id": "u-9", "name": "Admin" } }),
            StatusCode::FORBIDDEN,
        ),
    ] {
        let (status, body) = app.send(Method::PUT, route, &admin, body).await;
        assert_eq!(status, code, "{verb} the sink: {body}");
    }
}

/// What a grant cannot be is refused whole, naming the field: a `user` of
/// what is not a secret, a grant to the owner, a principal with no id.
#[tokio::test]
async fn a_grant_the_object_cannot_hold_is_refused() {
    let app = owned_secret().await;
    let owner = app.token_for("u-1", EDITOR);
    let (status, _) = connect(&app, &owner, "data").await;
    assert_eq!(status, StatusCode::CREATED);
    for (path, grant) in [
        (
            "/v1/connections/data/grants",
            json!({ "principal": { "kind": "user", "id": "u-2", "name": "Bruno" }, "relation": "user" }),
        ),
        (
            "/v1/secrets/key/grants",
            json!({ "principal": { "kind": "user", "id": "u-1", "name": "Ana" }, "relation": "manager" }),
        ),
        (
            "/v1/secrets/key/grants",
            json!({ "principal": { "kind": "group", "id": " ", "name": "Data" }, "relation": "user" }),
        ),
        (
            "/v1/secrets/key/grants",
            json!({ "principal": { "kind": "user", "id": "u-2", "name": "" }, "relation": "user" }),
        ),
    ] {
        let (status, body) = app
            .send(Method::PUT, path, &owner, json!({ "grants": [grant] }))
            .await;
        assert_eq!(
            (status, body["data"]["field"].as_str()),
            (StatusCode::BAD_REQUEST, Some("grants")),
            "{grant}: {body}"
        );
    }
    let (_, secret) = app
        .send(Method::GET, "/v1/secrets/key", &owner, json!(null))
        .await;
    assert_eq!(
        secret["grants"],
        json!([]),
        "nothing of a refused request is kept"
    );
}
