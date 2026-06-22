//! Atomic, idempotent workspace provisioning — stateless over Keycloak.
//!
//! A tenant **is** a Keycloak Organization: there is no local registry. Everything
//! is derived from the org `alias` (the slug) — the `workspace_id` is
//! `keasy-ws-{slug}`, which is also the OIDC clientId, the Docker stack project, and
//! the Swarm-secret prefix. The org's `attributes` carry the metadata teardown +
//! reconcile need (`owner_email`, the per-tenant `server_image` pin).
//!
//! `provision(name, handle, owner_email)` runs the reference reconcile:
//!   1. register an OIDC client in the shared Keycloak (authentication),
//!   2. attach the `keasy:role` mapper + owner/member client roles (authorization),
//!   3. create the workspace's Organization (with attributes) and invite the owner
//!      by email (native Keycloak invitation — they register-on-accept and join as a
//!      member; the `owner` role is granted by the tenant server on first login,
//!      keyed on `KEASY_OWNER_EMAIL`),
//!   4. bring up the instance stack via Docker.
//!
//! It is idempotent: if the OIDC client already exists, client creation + the
//! immutable Swarm secrets are skipped and only the org/invite/stack are re-ensured.
//! A *fresh* provision that fails after step 1 rolls back the partially-created
//! resources (delete client + org + stack). `deprovision(slug)` is the inverse and
//! is idempotent. `reconcile()` re-ensures every org's stack at its pinned image.

use std::sync::Arc;

use keasy_keycloak::admin::{KeycloakAdmin, OrgSummary};

use crate::config::ControlPlaneConfig;
use crate::docker::{DockerOrchestrator, StackSpec, TenantSecrets};

/// Org attribute keys the control-plane stores on each tenant Organization.
const ATTR_OWNER_EMAIL: &str = "owner_email";
const ATTR_SERVER_IMAGE: &str = "server_image";

/// A provisioned workspace as exposed by the control-plane CLI — projected from a
/// Keycloak Organization.
#[derive(Clone, serde::Serialize)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub url: String,
    pub owner_email: String,
}

impl WorkspaceInfo {
    /// Project a Keycloak Organization into the CLI's workspace view. The
    /// `workspace_id` is derived deterministically from the alias.
    fn from_org(org: &OrgSummary) -> Self {
        Self {
            id: workspace_id(&org.alias),
            name: org.name.clone(),
            slug: org.alias.clone(),
            url: org.url.clone(),
            owner_email: first_attr(org, ATTR_OWNER_EMAIL).unwrap_or_default().to_string(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProvisionError {
    #[error("keycloak: {0}")]
    Keycloak(String),
    #[error("docker: {0}")]
    Docker(String),
    #[error("invalid: {0}")]
    Invalid(String),
}

/// The provisioner: shared Keycloak admin client + Docker orchestrator. Stateless —
/// the Keycloak Organizations are the source of truth.
pub struct Provisioner {
    config: ControlPlaneConfig,
    keycloak: KeycloakAdmin,
    docker: DockerOrchestrator,
}

impl Provisioner {
    pub fn new(
        config: ControlPlaneConfig,
        stacks_dir: impl Into<std::path::PathBuf>,
    ) -> Result<Arc<Self>, String> {
        let keycloak = KeycloakAdmin::new(
            &config.oidc_issuer_url,
            &config.oidc_client_id,
            config.oidc_client_secret.clone(),
            config.oidc_internal_base_url.as_deref(),
        )?;
        let docker = DockerOrchestrator::new(config.clone(), stacks_dir);
        Ok(Arc::new(Self { config, keycloak, docker }))
    }

    /// Provision a workspace. `name` is the display label; `handle` is the unique
    /// routing identity (subdomain + Keycloak org alias), slugified here so the
    /// caller can't smuggle an invalid host. Uses the fleet default images.
    pub async fn provision(
        &self,
        name: &str,
        handle: &str,
        owner_email: &str,
    ) -> Result<WorkspaceInfo, ProvisionError> {
        let slug = slugify(handle);
        if slug.is_empty() {
            return Err(ProvisionError::Invalid(
                "handle must contain a letter or digit".into(),
            ));
        }
        let server_image = self.config.server_image.clone();
        let web_image = self.config.web_image.clone();
        self.provision_with(name, &slug, owner_email, &server_image, &web_image)
            .await
    }

    /// Provision (or re-ensure) a workspace with an explicit slug + images. The
    /// reconcile path supplies the org's pinned image; provision supplies the fleet
    /// default.
    ///
    /// Idempotent: if the OIDC client `keasy-ws-{slug}` already exists, the client
    /// and its immutable Swarm secrets are left untouched and only the org
    /// (attributes), owner invite, and stack are re-ensured. On a *fresh* create,
    /// any failure after the client is registered rolls the client + org + stack
    /// back, so a failed create leaves nothing behind.
    async fn provision_with(
        &self,
        name: &str,
        slug: &str,
        owner_email: &str,
        server_image: &str,
        web_image: &str,
    ) -> Result<WorkspaceInfo, ProvisionError> {
        let workspace_id = workspace_id(slug);
        let url = format!("https://{slug}.{}", self.config.base_domain);

        // Is the OIDC client already there? If so this is a re-ensure (secrets are
        // immutable and already minted); if not, we create it now and capture the
        // generated secret to mint the Swarm secrets.
        let existing_uuid = self
            .keycloak
            .get_client_uuid(&workspace_id)
            .await
            .map_err(ProvisionError::Keycloak)?;

        let (keycloak_uuid, client_secret) = match existing_uuid {
            Some(uuid) => (uuid, None),
            None => {
                let redirect_uri = format!("{url}/v1/auth/oidc-callback");
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
                (registered.keycloak_uuid, Some(registered.client_secret))
            }
        };
        let is_fresh = client_secret.is_some();

        let result = self
            .ensure_rest(
                &workspace_id,
                name,
                slug,
                &url,
                owner_email,
                client_secret.as_deref(),
                server_image,
                web_image,
            )
            .await;

        match result {
            Ok(info) => Ok(info),
            // Only a fresh create rolls back — re-ensuring a live tenant must never
            // tear it down on a transient failure.
            Err(e) if is_fresh => Err(self.rollback(&workspace_id, &keycloak_uuid, slug, e).await),
            Err(e) => Err(e),
        }
    }

    /// Best-effort teardown of a partially-created workspace; logs sub-failures and
    /// returns the original error unchanged.
    async fn rollback(
        &self,
        workspace_id: &str,
        keycloak_uuid: &str,
        slug: &str,
        original: ProvisionError,
    ) -> ProvisionError {
        if let Err(re) = self.docker.remove(workspace_id).await {
            tracing::warn!(error = %re, %workspace_id, "rollback: docker stack remove failed");
        }
        if let Err(re) = self.keycloak.delete_client(keycloak_uuid).await {
            tracing::warn!(error = %re, %workspace_id, "rollback: keycloak client delete failed");
        }
        // Delete the Organization if it was created (idempotent: skip if absent), so
        // a failed provision leaves no orphan org for the next same-handle attempt.
        match self.keycloak.resolve_org_id(slug).await {
            Ok(Some(org_id)) => {
                if let Err(re) = self.keycloak.delete_organization(&org_id).await {
                    tracing::warn!(error = %re, %workspace_id, "rollback: keycloak org delete failed");
                }
            }
            Ok(None) => {}
            Err(re) => tracing::warn!(error = %re, %workspace_id, "rollback: resolve org failed"),
        }
        original
    }

    /// The shared tail of provision/re-ensure: authorization wiring, the
    /// Organization (with attributes) + owner invite, (fresh-only) Swarm secrets,
    /// and the stack deploy.
    #[allow(clippy::too_many_arguments)]
    async fn ensure_rest(
        &self,
        workspace_id: &str,
        name: &str,
        slug: &str,
        url: &str,
        owner_email: &str,
        client_secret: Option<&str>,
        server_image: &str,
        web_image: &str,
    ) -> Result<WorkspaceInfo, ProvisionError> {
        // Authorization: the keasy:role mapper + the owner/member client roles.
        self.keycloak
            .ensure_role_mapper(workspace_id)
            .await
            .map_err(ProvisionError::Keycloak)?;
        self.keycloak
            .ensure_client_roles(workspace_id)
            .await
            .map_err(ProvisionError::Keycloak)?;

        // The Organization IS the tenant record. We persist only the owner email as
        // an attribute (reconcile re-reads it to re-render `KEASY_OWNER_EMAIL`). We
        // do NOT write `server_image`: absent ⇒ the tenant follows the fleet default,
        // so a default bump rolls out to everyone. A canary is the operator setting
        // the org's `server_image` attribute by hand — `select_server_image` honours
        // it, and `ensure_organization`'s merge leaves unspecified attributes intact.
        // Then invite the owner (idempotent — an already-onboarded owner is a no-op).
        let org_id = self
            .keycloak
            .ensure_organization(name, slug, url, &[(ATTR_OWNER_EMAIL, owner_email)])
            .await
            .map_err(ProvisionError::Keycloak)?;
        self.keycloak
            .invite_user_to_org(&org_id, owner_email)
            .await
            .map_err(ProvisionError::Keycloak)?;

        // Mint + create the Swarm secrets only on a fresh provision — they are
        // immutable and reused across rollouts, so a re-ensure leaves them as-is.
        if let Some(secret) = client_secret {
            let secrets = TenantSecrets::mint(secret);
            self.docker
                .create_secrets(workspace_id, &secrets)
                .await
                .map_err(ProvisionError::Docker)?;
        }

        let spec = StackSpec {
            workspace_id: workspace_id.to_string(),
            workspace_name: name.to_string(),
            slug: slug.to_string(),
            owner_email: owner_email.to_string(),
            server_image: server_image.to_string(),
            web_image: web_image.to_string(),
        };
        self.docker.deploy(&spec).await.map_err(ProvisionError::Docker)?;

        Ok(WorkspaceInfo {
            id: workspace_id.to_string(),
            name: name.to_string(),
            slug: slug.to_string(),
            url: url.to_string(),
            owner_email: owner_email.to_string(),
        })
    }

    /// Tear a workspace down by slug (or `keasy-ws-{slug}` id): remove its Docker
    /// stack + secrets, delete its OIDC client, delete its Organization. Idempotent
    /// — a missing client/org is treated as already gone.
    pub async fn deprovision(&self, slug_or_id: &str) -> Result<(), ProvisionError> {
        let slug = slugify(slug_or_id.strip_prefix("keasy-ws-").unwrap_or(slug_or_id));
        if slug.is_empty() {
            return Err(ProvisionError::Invalid("empty slug".into()));
        }
        let workspace_id = workspace_id(&slug);

        self.docker
            .remove(&workspace_id)
            .await
            .map_err(ProvisionError::Docker)?;
        if let Some(uuid) = self
            .keycloak
            .get_client_uuid(&workspace_id)
            .await
            .map_err(ProvisionError::Keycloak)?
        {
            self.keycloak
                .delete_client(&uuid)
                .await
                .map_err(ProvisionError::Keycloak)?;
        }
        if let Some(org_id) = self
            .keycloak
            .resolve_org_id(&slug)
            .await
            .map_err(ProvisionError::Keycloak)?
        {
            self.keycloak
                .delete_organization(&org_id)
                .await
                .map_err(ProvisionError::Keycloak)?;
        }
        Ok(())
    }

    /// List the live workspaces — projected from the Keycloak Organizations.
    pub async fn list(&self) -> Result<Vec<WorkspaceInfo>, ProvisionError> {
        Ok(self
            .keycloak
            .list_organizations()
            .await
            .map_err(ProvisionError::Keycloak)?
            .iter()
            .map(WorkspaceInfo::from_org)
            .collect())
    }

    /// Re-ensure every tenant: for each Organization, re-run the idempotent provision
    /// at the org's pinned `server_image` (attribute) — or the fleet default — which
    /// both heals drift (a missing stack is deployed) and rolls out version bumps.
    /// The orgs ARE the desired set; nothing is diffed against git, nothing is reaped.
    /// Each tenant is independent — one failure is recorded and the rest still run.
    pub async fn reconcile(&self) -> Result<ReconcileSummary, ProvisionError> {
        let orgs = self
            .keycloak
            .list_organizations()
            .await
            .map_err(ProvisionError::Keycloak)?;
        let mut summary = ReconcileSummary::default();
        for org in &orgs {
            let server_image = select_server_image(org, &self.config.server_image);
            let owner_email = first_attr(org, ATTR_OWNER_EMAIL).unwrap_or_default().to_string();
            let name = if org.name.is_empty() {
                org.alias.clone()
            } else {
                org.name.clone()
            };
            match self
                .provision_with(
                    &name,
                    &org.alias,
                    &owner_email,
                    &server_image,
                    &self.config.web_image,
                )
                .await
            {
                Ok(_) => summary.reconciled.push(org.alias.clone()),
                Err(e) => summary.record_error(&org.alias, &e),
            }
        }
        Ok(summary)
    }
}

/// What a reconcile round did — returned to the operator as JSON.
#[derive(Debug, Default, serde::Serialize)]
pub struct ReconcileSummary {
    pub reconciled: Vec<String>,
    pub errors: Vec<String>,
}

impl ReconcileSummary {
    fn record_error(&mut self, slug: &str, e: &ProvisionError) {
        tracing::error!(error = %e, %slug, "reconcile action failed");
        self.errors.push(format!("{slug}: {e}"));
    }
}

/// The deterministic workspace id for a slug — the OIDC clientId, Docker stack
/// project name, and Swarm-secret prefix all derive from it.
fn workspace_id(slug: &str) -> String {
    format!("keasy-ws-{slug}")
}

/// The image to (re-)deploy a tenant at: its per-tenant `server_image` attribute
/// pin if set, else the fleet default. Pure — unit-tested.
fn select_server_image(org: &OrgSummary, default: &str) -> String {
    first_attr(org, ATTR_SERVER_IMAGE)
        .filter(|s| !s.is_empty())
        .unwrap_or(default)
        .to_string()
}

/// First value of an org attribute, if present.
fn first_attr<'a>(org: &'a OrgSummary, key: &str) -> Option<&'a str> {
    org.attributes.get(key).and_then(|v| v.first()).map(|s| s.as_str())
}

/// Lowercase, `[a-z0-9-]`-only slug from a workspace handle (no leading/trailing
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn org(alias: &str, attrs: &[(&str, &str)]) -> OrgSummary {
        let attributes: HashMap<String, Vec<String>> = attrs
            .iter()
            .map(|(k, v)| (k.to_string(), vec![v.to_string()]))
            .collect();
        OrgSummary {
            id: format!("org-{alias}"),
            alias: alias.to_string(),
            name: alias.to_string(),
            url: format!("https://{alias}.x"),
            attributes,
        }
    }

    const DEFAULT_SERVER: &str = "server:default";

    #[test]
    fn slugify_normalizes_handles() {
        assert_eq!(slugify("Acme Corp"), "acme-corp");
        assert_eq!(slugify("--Glo_bex--"), "glo-bex");
        assert_eq!(slugify("a!!!b"), "a-b");
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn workspace_id_is_deterministic_from_slug() {
        assert_eq!(workspace_id("acme"), "keasy-ws-acme");
    }

    #[test]
    fn server_image_pin_overrides_default() {
        let pinned = org("acme", &[(ATTR_SERVER_IMAGE, "server:canary")]);
        assert_eq!(select_server_image(&pinned, DEFAULT_SERVER), "server:canary");
    }

    #[test]
    fn server_image_falls_back_to_default_when_unset_or_empty() {
        let none = org("globex", &[]);
        assert_eq!(select_server_image(&none, DEFAULT_SERVER), DEFAULT_SERVER);
        let empty = org("initech", &[(ATTR_SERVER_IMAGE, "")]);
        assert_eq!(select_server_image(&empty, DEFAULT_SERVER), DEFAULT_SERVER);
    }

    #[test]
    fn workspace_info_projects_from_org_attributes() {
        let o = org("acme", &[(ATTR_OWNER_EMAIL, "owner@acme.test")]);
        let info = WorkspaceInfo::from_org(&o);
        assert_eq!(info.id, "keasy-ws-acme");
        assert_eq!(info.slug, "acme");
        assert_eq!(info.owner_email, "owner@acme.test");
        assert_eq!(info.url, "https://acme.x");
    }
}
