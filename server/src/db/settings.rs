use secrecy::SecretString;
use serde::{Serialize, de::DeserializeOwned};

use crate::settings::ai::AiSettings;
use crate::settings::org::OrgSettings;
use crate::settings::preferences::Preferences;

use super::Database;

impl Database {
    pub async fn get_setting<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let conn = self.conn.lock().await;
        let json = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .ok()?;
        serde_json::from_str(&json).ok()
    }

    pub async fn set_setting<T: Serialize>(&self, key: &str, value: &T) {
        let json = serde_json::to_string(value).expect("serialize setting");
        let conn = self.conn.lock().await;
        let _ = conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, &json],
        );
    }

    pub async fn get_org_settings(&self) -> Option<OrgSettings> {
        self.get_setting("org_settings").await
    }

    pub async fn set_org_settings(&self, settings: &OrgSettings) {
        self.set_setting("org_settings", settings).await;
    }

    pub async fn get_preferences(&self) -> Preferences {
        self.get_setting("preferences").await.unwrap_or_default()
    }

    pub async fn set_preferences(&self, prefs: &Preferences) {
        self.set_setting("preferences", prefs).await;
    }

    pub async fn get_ai_settings(&self) -> Option<AiSettings> {
        let public: serde_json::Value = self.get_setting("ai_settings").await?;
        let api_key_bytes = self.get_secret("ai_settings").await?;
        let api_key = SecretString::from(String::from_utf8(api_key_bytes).ok()?);
        Some(AiSettings {
            provider: public["provider"].as_str()?.to_string(),
            api_key,
            model: public["model"].as_str().map(String::from),
            max_tokens: public["max_tokens"].as_u64().map(|v| v as u32),
        })
    }

    pub async fn set_ai_settings(&self, s: &AiSettings) {
        use secrecy::ExposeSecret;
        self.set_setting(
            "ai_settings",
            &serde_json::json!({
                "provider": s.provider,
                "model": s.model,
                "max_tokens": s.max_tokens,
            }),
        )
        .await;
        self.set_secret("ai_settings", s.api_key.expose_secret().as_bytes())
            .await;
    }

    pub async fn get_dashboard_layout(&self, job_id: &str) -> Option<serde_json::Value> {
        self.get_setting(&format!("dashboard:{job_id}")).await
    }

    pub async fn set_dashboard_layout(&self, job_id: &str, value: &serde_json::Value) {
        self.set_setting(&format!("dashboard:{job_id}"), value)
            .await;
    }
}
