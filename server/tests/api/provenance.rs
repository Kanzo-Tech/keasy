//! Who made each resource and who changed it last, as they were named when
//! they did: the display name comes from the token at write time.

use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{ADMIN, DEAD, EDITOR, fake_s3, spawn_app};
use keasy_server::domain::Direction;

/// A secret and a connection record their creator; an admin's change records
/// the admin as the one who updated it and keeps who created it.
#[tokio::test]
async fn a_secret_and_a_connection_name_who_created_and_who_updated_them() {
    let app = spawn_app().await;
    let ana = app.token_profiled(
        "u-ana",
        EDITOR,
        json!({ "name": "Ana Duarte", "preferred_username": "ana" }),
    );
    let bruno = app.token_profiled("u-bruno", ADMIN, json!({ "name": "Bruno" }));
    let s3 = fake_s3().await;

    let (status, secret) = app
        .send(
            Method::POST,
            "/v1/secrets",
            &ana,
            json!({ "name": "minio", "probe_url": "s3://b/", "spec": {
                "kind": "s3", "access_key_id": "AK", "secret_access_key": "s", "endpoint": s3
            }}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{secret}");
    assert_eq!(
        secret["created_by"],
        json!({ "id": "u-ana", "name": "Ana Duarte" })
    );
    assert!(secret["created_at"].is_string());
    assert!(
        secret.get("updated_by").is_none() && secret.get("updated_at").is_none(),
        "nobody has changed it yet: {secret}"
    );

    let (status, connection) = app
        .send(
            Method::POST,
            "/v1/connections",
            &ana,
            json!({ "name": "data", "secret": "minio", "target": { "url": "s3://b/data/" } }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{connection}");
    assert_eq!(connection["created_by"]["name"], "Ana Duarte");
    assert!(connection.get("updated_by").is_none(), "{connection}");

    let (status, renamed) = app
        .send(
            Method::PATCH,
            "/v1/connections/data",
            &bruno,
            json!({ "name": "people" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(renamed["created_by"]["id"], "u-ana", "the creator is kept");
    assert_eq!(
        renamed["updated_by"],
        json!({ "id": "u-bruno", "name": "Bruno" })
    );
    assert!(renamed["updated_at"].is_string());

    let (status, renamed) = app
        .send(
            Method::PATCH,
            "/v1/secrets/minio",
            &bruno,
            json!({ "name": "store" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(renamed["created_by"]["name"], "Ana Duarte");
    assert_eq!(renamed["updated_by"]["name"], "Bruno");

    let (_, listed) = app
        .send(Method::GET, "/v1/connections", &ana, json!(null))
        .await;
    assert_eq!(listed[0]["updated_by"]["name"], "Bruno", "{listed}");
}

/// A graph names its creator; without a name in the token, their username; and
/// without either, a placeholder rather than the `sub`.
#[tokio::test]
async fn a_graph_names_its_creator_by_name_then_username_then_a_placeholder() {
    let app = spawn_app().await;
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;

    for (profile, expected) in [
        (
            json!({ "name": "Ana Duarte", "preferred_username": "ana" }),
            "Ana Duarte",
        ),
        (json!({ "preferred_username": "ana" }), "ana"),
        (json!({}), "Unknown user"),
    ] {
        let token = app.token_profiled("u-ana", EDITOR, profile);
        let (status, graph) = app
            .send(
                Method::POST,
                "/v1/graphs",
                &token,
                json!({ "script": "x", "sink_connection": "sink" }),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{graph}");
        assert_eq!(
            graph["created_by"],
            json!({ "id": "u-ana", "name": expected })
        );
        assert!(graph["created_at"].is_string());
        assert!(graph.get("updated_by").is_none(), "{graph}");
    }
}

/// The name is the one the token carried when the row was written: a later
/// token with another name does not rename what was made.
#[tokio::test]
async fn the_name_is_kept_from_when_it_was_written() {
    let app = spawn_app().await;
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let before = app.token_profiled("u-ana", EDITOR, json!({ "name": "Ana Duarte" }));
    let after = app.token_profiled("u-ana", EDITOR, json!({ "name": "Ana D. Silva" }));

    let (_, graph) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &before,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let path = format!("/v1/graphs/{}", graph["id"].as_str().unwrap());
    let (_, read) = app.send(Method::GET, &path, &after, json!(null)).await;
    assert_eq!(read["created_by"]["name"], "Ana Duarte");
}

/// A dashboard names who saved it first and who saved it last.
#[tokio::test]
async fn a_dashboard_names_who_saved_it_first_and_last() {
    let app = spawn_app().await;
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let ana = app.token_profiled("u-ana", EDITOR, json!({ "name": "Ana Duarte" }));
    let bruno = app.token_profiled("u-bruno", ADMIN, json!({ "name": "Bruno" }));
    let (_, graph) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &ana,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let path = format!("/v1/graphs/{}/dashboard", graph["id"].as_str().unwrap());

    let (status, first) = app
        .send(Method::PUT, &path, &ana, json!({ "spec": { "cards": [] } }))
        .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(
        first["created_by"],
        json!({ "id": "u-ana", "name": "Ana Duarte" })
    );
    assert!(first.get("updated_by").is_none(), "{first}");

    let (status, second) = app
        .send(
            Method::PUT,
            &path,
            &bruno,
            json!({ "spec": { "cards": [1] } }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second["created_by"]["name"], "Ana Duarte");
    assert_eq!(
        second["updated_by"],
        json!({ "id": "u-bruno", "name": "Bruno" })
    );
    let (_, read) = app.send(Method::GET, &path, &ana, json!(null)).await;
    assert_eq!(read["updated_by"]["name"], "Bruno");
}

/// A graph's rules name who saved them first and who saved them last.
#[tokio::test]
async fn rules_name_who_saved_them_first_and_last() {
    let app = spawn_app().await;
    app.credential("key", DEAD, "u-1").await;
    app.connection("sink", "key", Direction::Sink, "u-1").await;
    let ana = app.token_profiled("u-ana", EDITOR, json!({ "name": "Ana Duarte" }));
    let bruno = app.token_profiled("u-bruno", ADMIN, json!({ "name": "Bruno" }));
    let (_, graph) = app
        .send(
            Method::POST,
            "/v1/graphs",
            &ana,
            json!({ "script": "x", "sink_connection": "sink" }),
        )
        .await;
    let path = format!("/v1/graphs/{}/rules", graph["id"].as_str().unwrap());

    let (status, first) = app
        .send(Method::PUT, &path, &ana, json!({ "shapes": "" }))
        .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(
        first["created_by"],
        json!({ "id": "u-ana", "name": "Ana Duarte" })
    );
    assert!(first.get("updated_by").is_none(), "{first}");

    let (status, second) = app
        .send(Method::PUT, &path, &bruno, json!({ "shapes": "# admin" }))
        .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second["created_by"]["name"], "Ana Duarte");
    assert_eq!(
        second["updated_by"],
        json!({ "id": "u-bruno", "name": "Bruno" })
    );
    let (_, read) = app.send(Method::GET, &path, &ana, json!(null)).await;
    assert_eq!(read["updated_by"]["name"], "Bruno");
}

/// What an instance declares at boot is the bootstrap's: nobody who signs in.
#[tokio::test]
async fn a_declared_secret_is_the_bootstraps() {
    let app = spawn_app().await;
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(
        file.path(),
        json!({ "secrets": [{ "name": "declared", "spec": {
            "kind": "s3", "access_key_id": "AK", "secret_access_key": "s"
        }}]})
        .to_string(),
    )
    .unwrap();
    keasy_server::bootstrap::ensure_declared(&app.db, file.path().to_str().unwrap()).await;

    let editor = app.token(EDITOR);
    let (status, secret) = app
        .send(Method::GET, "/v1/secrets/declared", &editor, json!(null))
        .await;
    assert_eq!(status, StatusCode::OK, "{secret}");
    assert_eq!(
        secret["created_by"],
        json!({ "id": "bootstrap", "name": "Bootstrap" })
    );
    assert_eq!(secret["can_modify"], false, "only an admin changes it");
}
