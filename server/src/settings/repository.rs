use async_trait::async_trait;

use super::ai::AiSettings;
use super::org::OrgSettings;
use super::preferences::Preferences;

#[async_trait]
pub trait SettingsRepository: Send + Sync {
    async fn get_org_settings(&self) -> Option<OrgSettings>;
    async fn set_org_settings(&self, settings: &OrgSettings);

    async fn get_preferences(&self) -> Preferences;
    async fn set_preferences(&self, prefs: &Preferences);

    async fn get_ai_provider(&self, provider_id: &str) -> Option<AiSettings>;
    async fn set_ai_provider(&self, provider_id: &str, settings: &AiSettings);
    async fn delete_ai_provider(&self, provider_id: &str);
    async fn list_ai_providers(&self) -> Vec<AiSettings>;

    async fn get_dashboard_layout(&self, job_id: &str) -> Option<serde_json::Value>;
    async fn set_dashboard_layout(&self, job_id: &str, value: &serde_json::Value);
}
