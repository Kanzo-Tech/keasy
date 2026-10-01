use crate::helpers::spawn_app;

#[tokio::test]
async fn liveness_answers_without_a_token() {
    let app = spawn_app().await;
    let response = app
        .client
        .get(format!("{}/healthz/live", app.address))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
}

/// The look is read before anyone signs in: no token, and the instance's name.
#[tokio::test]
async fn branding_answers_without_a_token() {
    let app = spawn_app().await;
    let response = app
        .client
        .get(format!("{}/v1/branding", app.address))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["name"], "Dev");
    assert_eq!(body["themes"], serde_json::json!([]));
    assert_eq!(body["lock"], false);
}
