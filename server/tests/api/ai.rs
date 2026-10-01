use std::sync::{Arc, Mutex};

use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::IntoResponse;
use axum::{Json, Router, routing::post};
use secrecy::SecretString;
use serde_json::{Value, json};

use crate::helpers::{spawn_app, spawn_app_with};
use keasy_server::configuration::AiSettings;

/// What the fake gateway was sent: the bearer it saw, and the body.
type Seen = Arc<Mutex<Vec<(String, Value)>>>;

/// A gateway that answers every chat completion with two SSE chunks, and
/// records what it was asked.
async fn gateway() -> (String, Seen) {
    let seen: Seen = Arc::default();
    let record = seen.clone();
    let app = Router::new().route(
        "/v1/chat/completions",
        post(move |headers: HeaderMap, Json(body): Json<Value>| {
            let record = record.clone();
            async move {
                let bearer = headers[header::AUTHORIZATION].to_str().unwrap().to_string();
                record.lock().unwrap().push((bearer, body));
                (
                    [(header::CONTENT_TYPE, "text/event-stream")],
                    "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n",
                )
                    .into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, seen)
}

async fn relay(app: &crate::helpers::TestApp, body: Value) -> (StatusCode, String, String) {
    let response = app
        .client
        .post(format!("{}/v1/ai/chat/completions", app.address))
        .bearer_auth(app.token(&["member"]))
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default();
    (status, content_type, response.text().await.unwrap())
}

/// The browser speaks the protocol; the server adds the workspace's key and
/// who asked, holds the answer to its alias's ceiling, and streams back what
/// the gateway sends, untouched.
#[tokio::test]
async fn a_call_is_relayed_with_the_workspace_key_and_streamed_back() {
    let (url, seen) = gateway().await;
    let app = spawn_app_with(Some(AiSettings {
        url,
        key: SecretString::from("sk-workspace"),
    }))
    .await;

    let (status, content_type, body) = relay(
        &app,
        json!({
            "model": "chat",
            "stream": true,
            "messages": [{ "role": "user", "content": "hello" }],
            "max_tokens": 100000,
            "user": "someone-else",
            "tools": [{ "type": "function", "function": { "name": "query" } }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(content_type, "text/event-stream");
    assert!(
        body.contains("\"content\":\"hi\"") && body.ends_with("data: [DONE]\n\n"),
        "{body}"
    );

    let (bearer, sent) = seen.lock().unwrap()[0].clone();
    assert_eq!(bearer, "Bearer sk-workspace");
    assert_eq!(
        sent["user"], "u-1",
        "who asked is the token's subject, not the page's say"
    );
    assert_eq!(sent["max_tokens"], 4096, "held to the alias's ceiling");
    assert_eq!(sent["stream"], true);
    assert_eq!(
        sent["tools"][0]["function"]["name"], "query",
        "the rest passes through"
    );
    assert!(
        sent.get("cache").is_none(),
        "a conversation is never cached"
    );
}

#[tokio::test]
async fn a_field_completion_asks_for_the_cache() {
    let (url, seen) = gateway().await;
    let app = spawn_app_with(Some(AiSettings {
        url,
        key: SecretString::from("k"),
    }))
    .await;
    let (status, _, _) = relay(
        &app,
        json!({ "model": "complete", "messages": [], "cache": { "no-cache": true } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, sent) = seen.lock().unwrap()[0].clone();
    assert_eq!(sent["cache"], json!({ "use-cache": true }));
    assert_eq!(sent["max_tokens"], 512);
}

/// A page names what a model is for, never a provider's model.
#[tokio::test]
async fn only_an_alias_is_a_model() {
    let (url, seen) = gateway().await;
    let app = spawn_app_with(Some(AiSettings {
        url,
        key: SecretString::from("k"),
    }))
    .await;
    let (status, _, _) = relay(&app, json!({ "model": "gpt-4o", "messages": [] })).await;
    assert!(status.is_client_error(), "{status}");
    assert!(
        seen.lock().unwrap().is_empty(),
        "nothing reached the gateway"
    );
}

#[tokio::test]
async fn a_workspace_without_a_gateway_says_so() {
    let app = spawn_app().await;
    let (status, body) = app
        .send(
            Method::POST,
            "/v1/ai/chat/completions",
            &app.token(&["member"]),
            json!({ "model": "chat", "messages": [] }),
        )
        .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(body["code"], "ai_not_configured");
}
