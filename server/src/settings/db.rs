use async_trait::async_trait;
use diesel::prelude::*;
use secrecy::SecretString;
use serde::{Serialize, de::DeserializeOwned};

use crate::db::diesel_schema::settings::dsl;
use crate::db::Repos;
use crate::settings::ai::AiSettings;
use crate::settings::org::OrgSettings;
use crate::settings::preferences::Preferences;

use super::repository::SettingsRepository;

const KNOWN_AI_PROVIDERS: &[&str] = &["anthropic", "openai"];

// ── DieselSettingsRepo ─────────────────────────────────────────────

pub struct DieselSettingsRepo {
    repos: Repos,
}

impl DieselSettingsRepo {
    pub fn new(repos: Repos) -> Self {
        Self { repos }
    }

    async fn get_setting<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let key = key.to_string();
        let json: String = self
            .repos
            .diesel_pool
            .get()
            .await
            .ok()?
            .interact(move |conn| {
                dsl::settings
                    .filter(dsl::key.eq(&key))
                    .select(dsl::value)
                    .first::<String>(conn)
                    .optional()
            })
            .await
            .ok()?
            .ok()??;
        serde_json::from_str(&json).ok()
    }

    async fn set_setting<T: Serialize>(&self, key: &str, value: &T) {
        let json = serde_json::to_string(value).expect("serialize setting");
        let key = key.to_string();
        let Ok(pool_conn) = self.repos.diesel_pool.get().await else {
            return;
        };
        let _ = pool_conn
            .interact(move |conn| {
                diesel::insert_into(dsl::settings)
                    .values((dsl::key.eq(&key), dsl::value.eq(&json)))
                    .on_conflict(dsl::key)
                    .do_update()
                    .set(dsl::value.eq(&json))
                    .execute(conn)
            })
            .await;
    }

    async fn delete_setting(&self, key: &str) {
        let key = key.to_string();
        let Ok(pool_conn) = self.repos.diesel_pool.get().await else {
            return;
        };
        let _ = pool_conn
            .interact(move |conn| {
                diesel::delete(dsl::settings.filter(dsl::key.eq(&key))).execute(conn)
            })
            .await;
    }
}

#[async_trait]
impl SettingsRepository for DieselSettingsRepo {
    async fn get_org_settings(&self) -> Option<OrgSettings> {
        self.get_setting("org_settings").await
    }

    async fn set_org_settings(&self, settings: &OrgSettings) {
        self.set_setting("org_settings", settings).await;
    }

    async fn get_preferences(&self) -> Preferences {
        self.get_setting("preferences").await.unwrap_or_default()
    }

    async fn set_preferences(&self, prefs: &Preferences) {
        self.set_setting("preferences", prefs).await;
    }

    async fn get_ai_provider(&self, provider_id: &str) -> Option<AiSettings> {
        let key = format!("ai_provider:{provider_id}");
        let public: serde_json::Value = self.get_setting(&key).await?;
        let api_key_bytes = self.repos.get_secret(&key).await?;
        let api_key = SecretString::from(String::from_utf8(api_key_bytes).ok()?);
        Some(AiSettings {
            provider: public["provider"].as_str()?.to_string(),
            api_key,
            model: public["model"].as_str().map(String::from),
            max_tokens: public["max_tokens"].as_u64().map(|v| v as u32),
        })
    }

    async fn set_ai_provider(&self, provider_id: &str, s: &AiSettings) {
        use secrecy::ExposeSecret;
        let key = format!("ai_provider:{provider_id}");
        self.set_setting(
            &key,
            &serde_json::json!({
                "provider": s.provider,
                "model": s.model,
                "max_tokens": s.max_tokens,
            }),
        )
        .await;
        self.repos
            .set_secret(&key, s.api_key.expose_secret().as_bytes())
            .await;
    }

    async fn delete_ai_provider(&self, provider_id: &str) {
        let key = format!("ai_provider:{provider_id}");
        self.delete_setting(&key).await;
        self.repos.delete_secret(&key).await;
    }

    async fn list_ai_providers(&self) -> Vec<AiSettings> {
        let mut result = Vec::new();
        for id in KNOWN_AI_PROVIDERS {
            if let Some(s) = self.get_ai_provider(id).await {
                result.push(s);
            }
        }
        result
    }

    async fn get_dashboard_layout(&self, job_id: &str) -> Option<serde_json::Value> {
        self.get_setting(&format!("dashboard:{job_id}")).await
    }

    async fn set_dashboard_layout(&self, job_id: &str, value: &serde_json::Value) {
        self.set_setting(&format!("dashboard:{job_id}"), value)
            .await;
    }
}
