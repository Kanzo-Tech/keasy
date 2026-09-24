use rusqlite::OptionalExtension;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::db::{Database, DbError, DbResult};
use crate::settings::ai::AiSettings;
use crate::settings::org::{OrgSettings, WorkspaceIdentity};

const KNOWN_AI_PROVIDERS: &[&str] = &["anthropic", "openai"];

/// What an AI provider stores in `settings`; the key lives in `secrets`.
#[derive(Serialize, Deserialize)]
struct AiProviderRecord {
    provider: String,
    model: Option<String>,
    max_tokens: Option<u32>,
}

impl Database {
    async fn get_setting<T: DeserializeOwned>(&self, key: &str) -> DbResult<Option<T>> {
        let json: Option<String> = self
            .read()
            .await
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        Ok(json.map(|j| serde_json::from_str(&j)).transpose()?)
    }

    async fn set_setting<T: Serialize>(&self, key: &str, value: &T) -> DbResult<()> {
        self.write().await.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, &serde_json::to_string(value)?],
        )?;
        Ok(())
    }

    async fn delete_setting(&self, key: &str) -> DbResult<()> {
        self.write()
            .await
            .execute("DELETE FROM settings WHERE key = ?1", [key])?;
        Ok(())
    }

    pub async fn get_org_settings(&self) -> DbResult<Option<OrgSettings>> {
        self.get_setting("org_settings").await
    }

    pub async fn set_org_settings(&self, settings: &OrgSettings) -> DbResult<()> {
        self.set_setting("org_settings", settings).await
    }

    pub async fn get_workspace_identity(&self) -> DbResult<Option<WorkspaceIdentity>> {
        self.get_setting("workspace_identity").await
    }

    pub async fn set_workspace_identity(&self, identity: &WorkspaceIdentity) -> DbResult<()> {
        self.set_setting("workspace_identity", identity).await
    }

    pub async fn get_ai_provider(&self, provider_id: &str) -> DbResult<Option<AiSettings>> {
        let key = format!("ai_provider:{provider_id}");
        let Some(record) = self.get_setting::<AiProviderRecord>(&key).await? else {
            return Ok(None);
        };
        let api_key = match self.get_secret(&key).await? {
            Some(bytes) => SecretString::from(
                String::from_utf8(bytes).map_err(|e| DbError::Secret(e.to_string()))?,
            ),
            None => SecretString::default(),
        };
        Ok(Some(AiSettings {
            provider: record.provider,
            api_key,
            model: record.model,
            max_tokens: record.max_tokens,
        }))
    }

    pub async fn set_ai_provider(&self, provider_id: &str, s: &AiSettings) -> DbResult<()> {
        let key = format!("ai_provider:{provider_id}");
        self.set_setting(
            &key,
            &AiProviderRecord {
                provider: s.provider.clone(),
                model: s.model.clone(),
                max_tokens: s.max_tokens,
            },
        )
        .await?;
        self.set_secret(&key, s.api_key.expose_secret().as_bytes())
            .await
    }

    pub async fn delete_ai_provider(&self, provider_id: &str) -> DbResult<()> {
        let key = format!("ai_provider:{provider_id}");
        self.delete_setting(&key).await?;
        self.delete_secret(&key).await
    }

    /// `id`'s settings, or with no `id` the first provider configured.
    pub async fn ai_provider(&self, id: Option<&str>) -> DbResult<Option<AiSettings>> {
        match id {
            Some(id) => self.get_ai_provider(id).await,
            None => Ok(self.list_ai_providers().await?.into_iter().next()),
        }
    }

    pub async fn list_ai_providers(&self) -> DbResult<Vec<AiSettings>> {
        let mut result = Vec::new();
        for id in KNOWN_AI_PROVIDERS {
            if let Some(s) = self.get_ai_provider(id).await? {
                result.push(s);
            }
        }
        Ok(result)
    }
}
