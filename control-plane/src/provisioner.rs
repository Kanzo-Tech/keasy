//! Atomic, idempotent workspace provisioning.
//!
//! `POST /workspaces { name, owner_keycloak_sub }` runs the reference reconcile:
//!   1. register an OIDC client in the shared Keycloak (workspace identity),
//!   2. attach the `keasy:workspaces` protocol mapper,
//!   3. grant the owner access to the new workspace,
//!   4. bring up the instance stack via Docker.
//!
//! Any failure after step 1 rolls back the partially-created resources (delete
//! the OIDC client, tear the stack down), so a failed create leaves nothing
//! behind. `DELETE /workspaces/{id}` is the inverse and is idempotent.
//!
//! The in-memory registry maps `workspace_id → keycloak_uuid` so teardown can
//! find the client to delete. A production deployment would persist this (the
//! provisioner is otherwise stateless); for the reference it lives in memory.

use std::collections::HashMap;
use std::sync::Arc;

use keasy_keycloak::admin::KeycloakAdmin;
use tokio::sync::Mutex;

use crate::config::ControlPlaneConfig;
use crate::docker::{DockerOrchestrator, StackSpec};

/// A provisioned workspace as exposed by the control-plane API.
#[derive(Clone, serde::Serialize)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub url: String,
    pub owner_keycloak_sub: String,
}

/// Internal record — `WorkspaceInfo` plus the Keycloak-internal UUID needed for
/// teardown.
#[derive(Clone)]
struct WorkspaceRecord {
    info: WorkspaceInfo,
    keycloak_uuid: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ProvisionError {
    #[error("keycloak: {0}")]
    Keycloak(String),
    #[error("docker: {0}")]
    Docker(String),
    #[error("unknown workspace: {0}")]
    NotFound(String),
}

/// The provisioner: shared Keycloak admin client + Docker orchestrator + the
/// registry of live workspaces.
pub struct Provisioner {
    config: ControlPlaneConfig,
    keycloak: KeycloakAdmin,
    docker: DockerOrchestrator,
    registry: Mutex<HashMap<String, WorkspaceRecord>>,
}

impl Provisioner {
    pub fn new(config: ControlPlaneConfig, stacks_dir: impl Into<std::path::PathBuf>) -> Result<Arc<Self>, String> {
        let keycloak = KeycloakAdmin::new(
            &config.oidc_issuer_url,
            &config.oidc_client_id,
            config.oidc_client_secret.clone(),
            config.oidc_internal_base_url.as_deref(),
        )?;
        let docker = DockerOrchestrator::new(config.clone(), stacks_dir);
        Ok(Arc::new(Self {
            config,
            keycloak,
            docker,
            registry: Mutex::new(HashMap::new()),
        }))
    }

    /// Provision a workspace atomically. On any step failure after the OIDC
    /// client is created, the client (and any started stack) is rolled back.
    pub async fn provision(
        &self,
        name: &str,
        owner_keycloak_sub: &str,
    ) -> Result<WorkspaceInfo, ProvisionError> {
        let workspace_id = format!("keasy-ws-{}", uuid::Uuid::new_v4().simple());
        let slug = slugify(name);
        let host = format!("{slug}.{}", self.config.base_domain);
        let url = format!("https://{host}");
        let redirect_uri = format!("{url}/v1/auth/oidc-callback");

        // 1. Register the OIDC client (the workspace identity).
        let registered = self
            .keycloak
            .create_client(
                &workspace_id,
                name,
                Some(&format!("Keasy workspace: {name}")),
                &redirect_uri,
                &url,
            )
            .await
            .map_err(ProvisionError::Keycloak)?;

        // From here on, roll the client back on any failure.
        let result = self
            .provision_rest(
                &workspace_id,
                name,
                &slug,
                &url,
                owner_keycloak_sub,
                &registered.keycloak_uuid,
                &registered.client_secret,
            )
            .await;

        match result {
            Ok(info) => {
                self.registry.lock().await.insert(
                    workspace_id.clone(),
                    WorkspaceRecord {
                        info: info.clone(),
                        keycloak_uuid: registered.keycloak_uuid,
                    },
                );
                Ok(info)
            }
            Err(e) => {
                // Best-effort rollback — log but surface the original error.
                if let Err(re) = self.docker.down(&workspace_id).await {
                    tracing::warn!(error = %re, %workspace_id, "rollback: docker down failed");
                }
                if let Err(re) = self.keycloak.delete_client(&registered.keycloak_uuid).await {
                    tracing::warn!(error = %re, %workspace_id, "rollback: keycloak delete failed");
                }
                Err(e)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn provision_rest(
        &self,
        workspace_id: &str,
        name: &str,
        slug: &str,
        url: &str,
        owner_keycloak_sub: &str,
        keycloak_uuid: &str,
        client_secret: &str,
    ) -> Result<WorkspaceInfo, ProvisionError> {
        // 2. Attach the keasy:workspaces protocol mapper.
        self.keycloak
            .ensure_protocol_mapper(keycloak_uuid)
            .await
            .map_err(ProvisionError::Keycloak)?;

        // 3. Grant the owner access to the new workspace.
        self.keycloak
            .add_user_workspace(owner_keycloak_sub, workspace_id)
            .await
            .map_err(ProvisionError::Keycloak)?;

        // 4. Bring up the instance stack.
        let spec = StackSpec {
            workspace_id: workspace_id.to_string(),
            workspace_name: name.to_string(),
            slug: slug.to_string(),
            oidc_client_secret: client_secret.to_string(),
            owner_keycloak_sub: owner_keycloak_sub.to_string(),
        };
        self.docker.up(&spec).await.map_err(ProvisionError::Docker)?;

        Ok(WorkspaceInfo {
            id: workspace_id.to_string(),
            name: name.to_string(),
            slug: slug.to_string(),
            url: url.to_string(),
            owner_keycloak_sub: owner_keycloak_sub.to_string(),
        })
    }

    /// Tear a workspace down: stop its stack, delete its OIDC client. Idempotent.
    pub async fn deprovision(&self, workspace_id: &str) -> Result<(), ProvisionError> {
        let record = self.registry.lock().await.remove(workspace_id);
        let Some(record) = record else {
            return Err(ProvisionError::NotFound(workspace_id.to_string()));
        };
        self.docker
            .down(workspace_id)
            .await
            .map_err(ProvisionError::Docker)?;
        self.keycloak
            .delete_client(&record.keycloak_uuid)
            .await
            .map_err(ProvisionError::Keycloak)?;
        Ok(())
    }

    /// List the live workspaces (registry snapshot).
    pub async fn list(&self) -> Vec<WorkspaceInfo> {
        self.registry
            .lock()
            .await
            .values()
            .map(|r| r.info.clone())
            .collect()
    }
}

/// Lowercase, `[a-z0-9-]`-only slug from a workspace name (no leading/trailing
/// hyphens). Mirrors the server's org slug rule.
fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
