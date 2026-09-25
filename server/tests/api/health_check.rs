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
