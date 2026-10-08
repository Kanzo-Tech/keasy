use keasy_server::configuration::BrandingSettings;

use crate::helpers::{Options, spawn_app, spawn_app_with};

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

/// Ready is the database answering, asked without a token.
#[tokio::test]
async fn readiness_answers_when_the_database_does() {
    let app = spawn_app().await;
    let response = app
        .client
        .get(format!("{}/healthz/ready", app.address))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
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
    assert_eq!(body["families"], serde_json::json!([]));
    assert!(body.get("default").is_none());
    assert_eq!(body["lock"], false);
}

/// The generator's snippet comes back out as the families the web offers.
#[tokio::test]
async fn branding_serves_the_declared_families() {
    let branding = BrandingSettings::from_yaml(
        r#"
branding:
  logo: /acme.svg
  theme_css: '[data-theme="acme"] {}'
  families:
    - family: acme
      light: { value: acme, label: Acme }
      dark: { value: acme-dark, label: Acme Dark }
  default: acme
  lock: true
"#,
    )
    .unwrap();
    let app = spawn_app_with(Options {
        branding,
        ..Options::default()
    })
    .await;
    let body: serde_json::Value = app
        .client
        .get(format!("{}/v1/branding", app.address))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "name": "Dev",
            "organization": "acme",
            "logo": "/acme.svg",
            "theme_css": "[data-theme=\"acme\"] {}",
            "families": [{
                "family": "acme",
                "light": { "value": "acme", "label": "Acme" },
                "dark": { "value": "acme-dark", "label": "Acme Dark" },
            }],
            "default": "acme",
            "lock": true,
        })
    );
}
