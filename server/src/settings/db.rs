use rusqlite::OptionalExtension;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::db::{Database, DbError, DbResult};
use crate::settings::ai::{AiProvider, AiSettings};
use crate::settings::org::{OrgSettings, WorkspaceIdentity};

/// What an AI provider stores in `settings`; the key lives in `secrets`.
#[derive(Serialize, Deserialize)]
struct AiProviderRecord {
    model: Option<String>,
    max_tokens: Option<u32>,
}

fn ai_key(provider: AiProvider) -> String {
    format!("ai_provider:{}", provider.as_str())
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

    pub async fn get_ai_provider(&self, provider: AiProvider) -> DbResult<Option<AiSettings>> {
        let key = ai_key(provider);
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
            provider,
            api_key,
            model: record.model,
            max_tokens: record.max_tokens,
        }))
    }

    pub async fn set_ai_provider(&self, s: &AiSettings) -> DbResult<()> {
        let key = ai_key(s.provider);
        self.set_setting(
            &key,
            &AiProviderRecord {
                model: s.model.clone(),
                max_tokens: s.max_tokens,
            },
        )
        .await?;
        self.set_secret(&key, s.api_key.expose_secret().as_bytes())
            .await
    }

    pub async fn delete_ai_provider(&self, provider: AiProvider) -> DbResult<()> {
        let key = ai_key(provider);
        self.delete_setting(&key).await?;
        self.delete_secret(&key).await
    }

    /// `provider`'s settings, or without one the first provider configured.
    pub async fn ai_provider(&self, provider: Option<AiProvider>) -> DbResult<Option<AiSettings>> {
        match provider {
            Some(provider) => self.get_ai_provider(provider).await,
            None => Ok(self.list_ai_providers().await?.into_iter().next()),
        }
    }

    pub async fn list_ai_providers(&self) -> DbResult<Vec<AiSettings>> {
        let mut result = Vec::new();
        for provider in AiProvider::ALL {
            if let Some(s) = self.get_ai_provider(provider).await? {
                result.push(s);
            }
        }
        Ok(result)
    }
}
