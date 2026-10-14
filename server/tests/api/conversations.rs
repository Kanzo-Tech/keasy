use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{EDITOR, READER, spawn_app};

/// A conversation is saved whole after each reply under the id the client made
/// — the first save starts it — and read back as it was saved: messages are a
/// JSON array no heavier than the cap, saved by its owner alone, read by
/// everyone.
#[tokio::test]
async fn a_conversation_is_saved_whole_and_read_back() {
    let app = spawn_app().await;
    let mine = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    let reader = app.token_for("u-3", READER);
    let id = "5d1e8f4a-2b7c-4e6d-8a9f-0c1b2d3e4f50";
    let path = format!("/v1/conversations/{id}");

    let (status, body) = app.send(Method::GET, &path, &mine, json!(null)).await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::NOT_FOUND, Some("conversation/not-found")),
        "a chat never saved is not there"
    );
    let (status, body) = app
        .send(
            Method::PUT,
            "/v1/conversations/no-such",
            &mine,
            json!({ "messages": [] }),
        )
        .await;
    assert_eq!(
        (status, body["data"]["field"].as_str()),
        (StatusCode::BAD_REQUEST, Some("id"))
    );

    let (status, started) = app
        .send(Method::PUT, &path, &mine, json!({ "messages": [] }))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        (
            started["id"].as_str(),
            started["messages"].clone(),
            started["built"].clone()
        ),
        (Some(id), json!([]), json!(false))
    );
    assert_eq!(started["owner"]["id"], "u-1");

    for messages in [json!({}), json!("x"), json!(null)] {
        let (status, body) = app
            .send(Method::PUT, &path, &mine, json!({ "messages": messages }))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{messages}");
        assert_eq!(body["data"]["field"], "messages");
    }
    let huge = "x".repeat(keasy_server::routes::conversations::MAX_MESSAGES_BYTES);
    let (status, _) = app
        .send(Method::PUT, &path, &mine, json!({ "messages": [huge] }))
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

    let messages = json!([
        { "id": "m1", "role": "assistant", "parts": [{ "type": "data-files" }] },
        { "id": "m2", "role": "user", "parts": [{ "type": "text", "text": "These 6 files" }] },
    ]);
    let (status, saved) = app
        .send(Method::PUT, &path, &mine, json!({ "messages": messages }))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["messages"], messages);
    assert_eq!(saved["updated_by"]["id"], "u-1");

    let (status, read) = app.send(Method::GET, &path, &reader, json!(null)).await;
    assert_eq!(
        (status, &read["messages"]),
        (StatusCode::OK, &messages),
        "everyone reads it"
    );

    let (status, body) = app
        .send(Method::PUT, &path, &theirs, json!({ "messages": [] }))
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
        "only its owner saves it"
    );
}

/// A graph is created with its caller's conversation, which is then the
/// graph's record: not saved over, and the chat carries on in another id.
#[tokio::test]
async fn a_graph_keeps_the_conversation_it_was_built_from() {
    let app = spawn_app().await;
    let mine = app.token_for("u-1", EDITOR);
    let theirs = app.token_for("u-2", EDITOR);
    app.credential("key", "u-1").await;
    app.connection("sink", "key", keasy_server::domain::Direction::Sink, "u-1")
        .await;
    let id = "7a2c9e10-4b3d-4f8e-9c1a-2d3e4f5a6b70";
    app.send(
        Method::PUT,
        &format!("/v1/conversations/{id}"),
        &mine,
        json!({ "messages": [{ "id": "m1" }] }),
    )
    .await;

    let create = |token: &str, conversation: &str| {
        let body =
            json!({ "script": "x", "sink_connection": "sink", "conversation": conversation });
        let token = token.to_string();
        let app = &app;
        async move { app.send(Method::POST, "/v1/graphs", &token, body).await }
    };
    let (status, body) = create(&mine, "no-such").await;
    assert_eq!(
        (status, body["data"]["field"].as_str()),
        (StatusCode::BAD_REQUEST, Some("conversation"))
    );
    let (status, body) = create(&theirs, id).await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::FORBIDDEN, Some("rbac/forbidden")),
        "a graph is built from its creator's own conversation"
    );

    let (status, graph) = create(&mine, id).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(graph["conversation"], id);
    let (_, read) = app
        .send(
            Method::GET,
            &format!("/v1/graphs/{}", graph["id"].as_str().unwrap()),
            &theirs,
            json!(null),
        )
        .await;
    assert_eq!(read["conversation"], id);

    let (_, built) = app
        .send(
            Method::GET,
            &format!("/v1/conversations/{id}"),
            &mine,
            json!(null),
        )
        .await;
    assert_eq!(built["built"], true);
    let (status, body) = app
        .send(
            Method::PUT,
            &format!("/v1/conversations/{id}"),
            &mine,
            json!({ "messages": [] }),
        )
        .await;
    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::CONFLICT, Some("conversation/built"))
    );
    let (status, copy) = app
        .send(
            Method::PUT,
            "/v1/conversations/8b3d0f21-5c4e-4a9f-8d2b-3e4f5a6b7c81",
            &mine,
            json!({ "messages": built["messages"] }),
        )
        .await;
    assert_eq!(
        (status, &copy["messages"]),
        (StatusCode::CREATED, &json!([{ "id": "m1" }]))
    );
}
