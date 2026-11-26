use std::sync::{Arc, Mutex};

use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::{Json, Router};
use serde_json::{Value, json};

use crate::helpers::{ADMIN, EDITOR, READER, spawn_app};

/// The last call a fake provider saw: its `Authorization` and body.
type Seen = Arc<Mutex<Option<(Option<String>, Value)>>>;

/// A provider that answers every call with one completion, and keeps the last
/// call's `Authorization` and body. Its root, as an admin would enter it.
async fn fake_provider() -> (String, Seen) {
    let seen: Seen = Default::default();
    let keep = seen.clone();
    let app = Router::new().fallback(move |headers: HeaderMap, Json(body): Json<Value>| async move {
        let auth = headers
            .get(header::AUTHORIZATION)
            .map(|v| v.to_str().unwrap().to_owned());
        *keep.lock().unwrap() = Some((auth, body));
        Json(json!({ "choices": [{ "index": 0, "message": { "role": "assistant", "content": "OK" } }] }))
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, seen)
}

/// With no external model a call is refused, and says so: the page runs its own.
#[tokio::test]
async fn with_no_model_set_a_call_is_ai_not_configured() {
    let app = spawn_app().await;
    let (status, body) = app
        .send(
            Method::POST,
            "/v1/ai/chat/completions",
            &app.token(READER),
            json!({ "messages": [{ "role": "user", "content": "hi" }] }),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "ai/not-configured");
}

/// The admin sets the model and the key; a reader's call goes to it, with the
/// workspace's key and model whatever the page asked for.
#[tokio::test]
async fn a_readers_call_goes_to_the_admins_model_with_the_workspaces_key() {
    let app = spawn_app().await;
    let (url, seen) = fake_provider().await;
    let (status, _) = app
        .send(
            Method::PUT,
            "/v1/ai/model",
            &app.token(ADMIN),
            json!({ "base_url": url, "model": "gpt-4o-mini", "api_key": "sk-test-workspace" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, answer) = app
        .send(
            Method::POST,
            "/v1/ai/chat/completions",
            &app.token(READER),
            json!({ "model": "anything", "messages": [{ "role": "user", "content": "hi" }] }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{answer}");
    assert_eq!(answer["choices"][0]["message"]["content"], "OK");
    let (auth, body) = seen.lock().unwrap().take().unwrap();
    assert_eq!(auth.as_deref(), Some("Bearer sk-test-workspace"));
    assert_eq!(body["model"], "gpt-4o-mini");
}

/// Only an admin tries a model; left out, the stored key is the one tried, and
/// nothing a test sends is stored.
#[tokio::test]
async fn an_admin_tests_a_model_with_the_stored_key_and_stores_nothing() {
    let app = spawn_app().await;
    let (url, seen) = fake_provider().await;
    let try_it = json!({ "base_url": url, "model": "llama3.2" });

    let (status, _) = app
        .send(Method::POST, "/v1/ai/model/test", &app.token(EDITOR), try_it.clone())
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, tested) = app
        .send(Method::POST, "/v1/ai/model/test", &app.token(ADMIN), try_it.clone())
        .await;
    assert_eq!(status, StatusCode::OK, "{tested}");
    assert!(tested["latency_ms"].is_u64());
    let (auth, _) = seen.lock().unwrap().take().unwrap();
    assert_eq!(auth, None, "nothing stored, no key");
    let (_, read) = app
        .send(Method::GET, "/v1/ai/model", &app.token(READER), json!(null))
        .await;
    assert_eq!(read, json!({ "external": null }), "a test stores nothing");

    app.send(
        Method::PUT,
        "/v1/ai/model",
        &app.token(ADMIN),
        json!({ "base_url": url, "model": "gpt-4o-mini", "api_key": "sk-test-stored" }),
    )
    .await;
    app.send(Method::POST, "/v1/ai/model/test", &app.token(ADMIN), try_it)
        .await;
    let (auth, _) = seen.lock().unwrap().take().unwrap();
    assert_eq!(auth.as_deref(), Some("Bearer sk-test-stored"));
}

/// A provider no one answers at is named, not the server.
#[tokio::test]
async fn a_provider_no_one_answers_at_is_ai_unreachable() {
    let app = spawn_app().await;
    let (status, body) = app
        .send(
            Method::POST,
            "/v1/ai/model/test",
            &app.token(ADMIN),
            json!({ "base_url": "http://127.0.0.1:1/v1", "model": "m", "api_key": "" }),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{body}");
    assert_eq!(body["code"], "ai/unreachable");
}
