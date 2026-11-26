use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::helpers::{ADMIN, READER, spawn_app};

/// The key goes in and never comes out: not in a set's answer, not in a read,
/// and no response schema has a field to carry one. A member learns only that
/// there is one.
#[tokio::test]
async fn no_response_carries_the_key() {
    let app = spawn_app().await;
    let (status, set) = app
        .send(
            Method::PUT,
            "/v1/ai/model",
            &app.token(ADMIN),
            json!({ "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini", "api_key": "sk-top-secret" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{set}");
    let (_, read) = app
        .send(Method::GET, "/v1/ai/model", &app.token(READER), json!(null))
        .await;
    assert_eq!(read["external"]["has_key"], true, "{read}");
    for body in [set, read] {
        assert!(!body.to_string().contains("sk-top-secret"), "{body}");
        assert!(!body.to_string().contains("api_key"), "{body}");
    }

    let spec = serde_json::to_value(keasy_server::startup::openapi()).unwrap();
    for view in ["AiModelView", "AiModelSettings"] {
        let schema = spec["components"]["schemas"][view].to_string();
        for secret in ["writeOnly", "password", "api_key"] {
            assert!(!schema.contains(secret), "{view} mentions {secret}: {schema}");
        }
    }
}

/// A workspace starts with none, so Ask runs on the page's model; an admin sets
/// one, every member reads it, and removing it is the start again.
#[tokio::test]
async fn an_admin_sets_the_model_every_member_reads_and_removing_it_leaves_none() {
    let app = spawn_app().await;
    let (admin, reader) = (app.token(ADMIN), app.token(READER));
    let (_, none) = app
        .send(Method::GET, "/v1/ai/model", &reader, json!(null))
        .await;
    assert_eq!(none, json!({ "external": null }));

    let (status, set) = app
        .send(
            Method::PUT,
            "/v1/ai/model",
            &admin,
            json!({ "base_url": " https://api.openai.com/v1/ ", "model": " gpt-4o-mini " }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{set}");
    let (_, read) = app
        .send(Method::GET, "/v1/ai/model", &reader, json!(null))
        .await;
    assert_eq!(read["external"]["base_url"], "https://api.openai.com/v1");
    assert_eq!(read["external"]["model"], "gpt-4o-mini");
    assert_eq!(read["external"]["has_key"], false);

    for _ in 0..2 {
        let (status, _) = app
            .send(Method::DELETE, "/v1/ai/model", &admin, json!(null))
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    let (_, gone) = app
        .send(Method::GET, "/v1/ai/model", &reader, json!(null))
        .await;
    assert_eq!(gone, json!({ "external": null }));
}

/// Changing the model keeps the key unless a new one is sent; an empty one
/// leaves the model with none, as a local Ollama takes.
#[tokio::test]
async fn leaving_the_key_out_keeps_it_and_an_empty_one_removes_it() {
    let app = spawn_app().await;
    let admin = app.token(ADMIN);
    let put = |body| app.send(Method::PUT, "/v1/ai/model", &admin, body);

    put(json!({ "base_url": "https://a.example/v1", "model": "m1", "api_key": "sk-1" })).await;
    let (_, kept) = put(json!({ "base_url": "https://a.example/v1", "model": "m2" })).await;
    assert_eq!(kept["model"], "m2");
    assert_eq!(kept["has_key"], true, "{kept}");

    let (_, removed) =
        put(json!({ "base_url": "http://ollama:11434/v1", "model": "qwen2.5:1.5b", "api_key": "" }))
            .await;
    assert_eq!(removed["has_key"], false, "{removed}");
}

/// Only an http(s) root and a named model are taken, each refusal on its field.
#[tokio::test]
async fn only_an_http_root_and_a_named_model_are_taken() {
    let app = spawn_app().await;
    let admin = app.token(ADMIN);
    for (body, field) in [
        (json!({ "base_url": "not a url", "model": "m" }), "base_url"),
        (json!({ "base_url": "ftp://a.example/v1", "model": "m" }), "base_url"),
        (json!({ "base_url": "https://a.example/v1?x=1", "model": "m" }), "base_url"),
        (json!({ "base_url": "https://user:sk@a.example/v1", "model": "m" }), "base_url"),
        (json!({ "base_url": "https://a.example/v1", "model": "  " }), "model"),
    ] {
        let (status, refusal) = app.send(Method::PUT, "/v1/ai/model", &admin, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{refusal}");
        assert_eq!(refusal["code"], "request/invalid", "{refusal}");
        assert_eq!(refusal["data"]["field"], field, "{refusal}");
    }
    let (_, none) = app
        .send(Method::GET, "/v1/ai/model", &admin, json!(null))
        .await;
    assert_eq!(none, json!({ "external": null }));
}
