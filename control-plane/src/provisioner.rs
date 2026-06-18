//! Atomic, idempotent workspace provisioning.
//!
//! `POST /workspaces { name, owner_keycloak_sub }` runs the reference reconcile:
//!   1. register an OIDC client in the shared Keycloak (authentication),
//!   2. attach the `keasy:role` mapper + owner/member client roles (authorization),
//!   3. create the workspace's Organization and add the owner as a member,
//!   4. grant the owner the `owner` client role,
//!   5. bring up the instance stack via Docker.
//!
//! Any failure after step 1 rolls back the partially-created resources (delete
//! the OIDC client, tear the stack down), so a failed create leaves nothing
//! behind. `DELETE /workspaces/{id}` is the inverse and is idempotent.
//!
//! The registry maps `workspace_id → {keycloak_uuid, …}` so teardown can find the
//! client to delete and the reconciler can diff desired-vs-real. It is persisted
//! in SQLite ([`crate::store`]) so it survives a control-plane restart — the
//! provisioner is otherwise stateless.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use keasy_keycloak::admin::KeycloakAdmin;

use crate::config::ControlPlaneConfig;
use crate::docker::{DockerOrchestrator, StackSpec, TenantSecrets};
use crate::manifest::DesiredTenant;
use crate::store::{Store, StoredWorkspace};

/// A provisioned workspace as exposed by the control-plane API.
#[derive(Clone, serde::Serialize)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub url: String,
    pub owner_keycloak_sub: String,
}

impl From<StoredWorkspace> for WorkspaceInfo {
    fn from(w: StoredWorkspace) -> Self {
        Self {
            id: w.id,
            name: w.name,
            slug: w.slug,
            url: w.url,
            owner_keycloak_sub: w.owner_keycloak_sub,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProvisionError {
    #[error("keycloak: {0}")]
    Keycloak(String),
    #[error("docker: {0}")]
    Docker(String),
    #[error("store: {0}")]
    Store(String),
    #[error("unknown workspace: {0}")]
    NotFound(String),
    #[error("invalid: {0}")]
    Invalid(String),
}

/// The provisioner: shared Keycloak admin client + Docker orchestrator + the
/// durable registry of live workspaces.
pub struct Provisioner {
    config: ControlPlaneConfig,
    keycloak: KeycloakAdmin,
    docker: DockerOrchestrator,
    store: Store,
}

impl Provisioner {
    pub fn new(
        config: ControlPlaneConfig,
        stacks_dir: impl Into<std::path::PathBuf>,
        db_path: impl AsRef<Path>,
    ) -> Result<Arc<Self>, String> {
        let keycloak = KeycloakAdmin::new(
            &config.oidc_issuer_url,
            &config.oidc_client_id,
            config.oidc_client_secret.clone(),
            config.oidc_internal_base_url.as_deref(),
        )?;
        let docker = DockerOrchestrator::new(config.clone(), stacks_dir);
        let store = Store::open(db_path.as_ref())?;
        Ok(Arc::new(Self {
            config,
            keycloak,
            docker,
            store,
        }))
    }

    /// Provision a workspace via the HTTP API. `name` is the display label; `handle`
    /// is the unique routing identity (subdomain + Keycloak org alias), slugified
    /// here so the caller can't smuggle an invalid host. Uses the env default images.
    pub async fn provision(
        &self,
        name: &str,
        handle: &str,
        owner_keycloak_sub: &str,
    ) -> Result<WorkspaceInfo, ProvisionError> {
        let slug = slugify(handle);
        if slug.is_empty() {
            return Err(ProvisionError::Invalid(
                "handle must contain a letter or digit".into(),
            ));
        }
        let server_image = self.config.server_image.clone();
        let web_image = self.config.web_image.clone();
        self.provision_with(name, &slug, owner_keycloak_sub, &server_image, &web_image)
            .await
    }

    /// Check a presented bearer key against the configured `CP_API_KEY`. With no key
    /// configured (dev), all callers pass; production always sets it.
    pub fn verify_api_key(&self, presented: Option<&str>) -> bool {
        use secrecy::ExposeSecret;
        match &self.config.api_key {
            None => true,
            Some(key) => presented.map(str::to_owned) == Some(key.expose_secret().to_string()),
        }
    }

    /// Provision a workspace atomically with an explicit slug + images (the
    /// reconcile path supplies a manifest slug + per-tenant pin). On any step
    /// failure after the OIDC client is created, the client (and any started
    /// stack) is rolled back.
    async fn provision_with(
        &self,
        name: &str,
        slug: &str,
        owner_keycloak_sub: &str,
        server_image: &str,
        web_image: &str,
    ) -> Result<WorkspaceInfo, ProvisionError> {
        let workspace_id = format!("keasy-ws-{}", uuid::Uuid::new_v4().simple());
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
                slug,
                &url,
                owner_keycloak_sub,
                &registered.client_secret,
                server_image,
                web_image,
            )
            .await;

        let info = match result {
            Ok(info) => info,
            Err(e) => {
                return Err(self
                    .rollback(&workspace_id, &registered.keycloak_uuid, slug, e)
                    .await)
            }
        };

        // Persist the registry record. A write failure here rolls the stack +
        // client back too, so a provision stays all-or-nothing.
        let stored = StoredWorkspace {
            id: info.id.clone(),
            name: info.name.clone(),
            slug: info.slug.clone(),
            url: info.url.clone(),
            owner_keycloak_sub: info.owner_keycloak_sub.clone(),
            keycloak_uuid: registered.keycloak_uuid.clone(),
            server_image: server_image.to_string(),
            oidc_client_secret: registered.client_secret.clone(),
        };
        if let Err(e) = self.store.upsert(&stored) {
            return Err(self
                .rollback(&workspace_id, &registered.keycloak_uuid, slug, ProvisionError::Store(e))
                .await);
        }
        Ok(info)
    }

    /// Best-effort teardown of a partially-created workspace; logs sub-failures
    /// and returns the original error unchanged.
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

    #[allow(clippy::too_many_arguments)]
    async fn provision_rest(
        &self,
        workspace_id: &str,
        name: &str,
        slug: &str,
        url: &str,
        owner_keycloak_sub: &str,
        client_secret: &str,
        server_image: &str,
        web_image: &str,
    ) -> Result<WorkspaceInfo, ProvisionError> {
        // 2. Attach the keasy:role mapper and ensure the owner/member client
        //    roles exist on this workspace client (authorization).
        self.keycloak
            .ensure_role_mapper(workspace_id)
            .await
            .map_err(ProvisionError::Keycloak)?;
        self.keycloak
            .ensure_client_roles(workspace_id)
            .await
            .map_err(ProvisionError::Keycloak)?;

        // 3. Create the workspace's Organization (membership container, keyed by
        //    the slug alias, carrying the home URL) and make the owner a member.
        let org_id = self
            .keycloak
            .ensure_organization(name, slug, url)
            .await
            .map_err(ProvisionError::Keycloak)?;
        self.keycloak
            .add_org_member(&org_id, owner_keycloak_sub)
            .await
            .map_err(ProvisionError::Keycloak)?;

        // 4. Grant the owner the `owner` client role (authorization).
        self.keycloak
            .assign_client_role(owner_keycloak_sub, workspace_id, "owner")
            .await
            .map_err(ProvisionError::Keycloak)?;

        // 5. Mint + create the workspace's Swarm secrets (the generated ones fix the
        //    FATAL-if-missing boot bug; OIDC comes from Keycloak), then deploy the
        //    Swarm stack. Secrets are immutable and reused across rollouts.
        let secrets = TenantSecrets::mint(client_secret);
        self.docker
            .create_secrets(workspace_id, &secrets)
            .await
            .map_err(ProvisionError::Docker)?;
        let spec = StackSpec {
            workspace_id: workspace_id.to_string(),
            workspace_name: name.to_string(),
            slug: slug.to_string(),
            server_image: server_image.to_string(),
            web_image: web_image.to_string(),
        };
        self.docker.deploy(&spec).await.map_err(ProvisionError::Docker)?;

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
        let Some(record) = self.store.get(workspace_id).map_err(ProvisionError::Store)? else {
            return Err(ProvisionError::NotFound(workspace_id.to_string()));
        };
        self.docker
            .remove(workspace_id)
            .await
            .map_err(ProvisionError::Docker)?;
        self.keycloak
            .delete_client(&record.keycloak_uuid)
            .await
            .map_err(ProvisionError::Keycloak)?;
        // Only forget the record once the external resources are actually gone, so
        // a failed teardown can be retried (the record is still there to find).
        self.store.remove(workspace_id).map_err(ProvisionError::Store)?;
        Ok(())
    }

    /// List the live workspaces (durable registry snapshot).
    pub fn list(&self) -> Result<Vec<WorkspaceInfo>, ProvisionError> {
        Ok(self
            .store
            .list()
            .map_err(ProvisionError::Store)?
            .into_iter()
            .map(WorkspaceInfo::from)
            .collect())
    }

    /// Workspaces owned by a Keycloak sub — onboarding short-circuits on this so a
    /// user who already has a workspace is never re-provisioned.
    pub fn list_by_owner(&self, sub: &str) -> Result<Vec<WorkspaceInfo>, ProvisionError> {
        Ok(self
            .store
            .list_by_owner(sub)
            .map_err(ProvisionError::Store)?
            .into_iter()
            .map(WorkspaceInfo::from)
            .collect())
    }

    /// Whether a handle is free, plus its normalized (slugified) form — the
    /// onboarding availability check, so the user never hits a failed provision.
    pub fn handle_status(&self, handle: &str) -> Result<(bool, String), ProvisionError> {
        let slug = slugify(handle);
        if slug.is_empty() {
            return Ok((false, slug));
        }
        let taken = self.store.slug_taken(&slug).map_err(ProvisionError::Store)?;
        Ok((!taken, slug))
    }

    /// Reconcile the live registry toward `desired` (the git seed): provision
    /// git-declared tenants that are absent, and roll out version changes. The
    /// registry is the source of truth for *existence* — workspaces are NEVER
    /// deprovisioned for being absent from git (self-serve tenants live only in the
    /// registry); teardown is the explicit `DELETE /workspaces/{id}`. Each action is
    /// independent — a per-tenant failure is recorded and the rest still run, so one
    /// broken tenant doesn't stall the fleet.
    pub async fn reconcile(
        &self,
        desired: &[DesiredTenant],
    ) -> Result<ReconcileSummary, ProvisionError> {
        let real = self.store.list().map_err(ProvisionError::Store)?;
        let mut summary = ReconcileSummary::default();
        for action in
            plan_reconcile(desired, &real, &self.config.server_image, &self.config.web_image)
        {
            match action {
                ReconcileAction::Provision(d) => {
                    match self
                        .provision_with(&d.name, &d.slug, &d.owner_keycloak_sub, &d.server_image, &d.web_image)
                        .await
                    {
                        Ok(_) => summary.provisioned.push(d.slug),
                        Err(e) => summary.record_error("provision", &d.slug, &e),
                    }
                }
                ReconcileAction::Rollout { record, desired } => {
                    match self.rollout(&record, &desired).await {
                        Ok(()) => summary.rolled_out.push(desired.slug),
                        Err(e) => summary.record_error("rollout", &desired.slug, &e),
                    }
                }
            }
        }
        Ok(summary)
    }

    /// Roll an existing instance to a new image: re-render the stack (reusing the
    /// stored OIDC secret) and `up --wait` (health-gated), then record the new
    /// version. The store is updated only after the rollout actually succeeds.
    async fn rollout(
        &self,
        record: &StoredWorkspace,
        desired: &DesiredTenant,
    ) -> Result<(), ProvisionError> {
        // A rollout re-deploys with the new image; the Swarm secrets created at
        // provision are reused (immutable), so no secret is re-passed here.
        let spec = StackSpec {
            workspace_id: record.id.clone(),
            workspace_name: record.name.clone(),
            slug: record.slug.clone(),
            server_image: desired.server_image.clone(),
            web_image: desired.web_image.clone(),
        };
        self.docker.deploy(&spec).await.map_err(ProvisionError::Docker)?;
        let updated = StoredWorkspace {
            server_image: desired.server_image.clone(),
            ..record.clone()
        };
        self.store.upsert(&updated).map_err(ProvisionError::Store)?;
        Ok(())
    }
}

/// What reconciling one round implies. Matched by slug (the stable key).
#[derive(Debug, PartialEq, Eq)]
enum ReconcileAction {
    Provision(DesiredTenant),
    Rollout {
        record: StoredWorkspace,
        desired: DesiredTenant,
    },
}

/// Pure diff of desired-vs-real, keyed by slug. No side effects — unit-tested.
///
/// The registry is the source of truth for *existence*: git-declared tenants that
/// are absent from the registry are provisioned (seed), declared tenants whose pin
/// changed are rolled out, and self-serve tenants (in the registry but NOT in git)
/// are kept — only rolled to the fleet default image when they've drifted, so they
/// still receive version bumps. Nothing is ever deprovisioned here.
fn plan_reconcile(
    desired: &[DesiredTenant],
    real: &[StoredWorkspace],
    default_server_image: &str,
    default_web_image: &str,
) -> Vec<ReconcileAction> {
    let real_by_slug: HashMap<&str, &StoredWorkspace> =
        real.iter().map(|r| (r.slug.as_str(), r)).collect();
    let desired_slugs: HashSet<&str> = desired.iter().map(|d| d.slug.as_str()).collect();

    let mut actions = Vec::new();
    // Git-declared tenants: provision if absent, roll out if the pin changed.
    for d in desired {
        match real_by_slug.get(d.slug.as_str()) {
            None => actions.push(ReconcileAction::Provision(d.clone())),
            Some(r) if r.server_image != d.server_image => actions.push(ReconcileAction::Rollout {
                record: (*r).clone(),
                desired: d.clone(),
            }),
            Some(_) => {} // already in sync
        }
    }
    // Self-serve tenants (in the registry, not in git): never reaped; only rolled to
    // the fleet default image when drifted, so API-created tenants get version bumps.
    for r in real {
        if !desired_slugs.contains(r.slug.as_str()) && r.server_image != default_server_image {
            actions.push(ReconcileAction::Rollout {
                record: r.clone(),
                desired: DesiredTenant {
                    slug: r.slug.clone(),
                    name: r.name.clone(),
                    owner_keycloak_sub: r.owner_keycloak_sub.clone(),
                    server_image: default_server_image.to_string(),
                    web_image: default_web_image.to_string(),
                },
            });
        }
    }
    actions
}

/// What a reconcile round did — returned by the API + logged by the pull loop.
#[derive(Debug, Default, serde::Serialize)]
pub struct ReconcileSummary {
    pub provisioned: Vec<String>,
    pub rolled_out: Vec<String>,
    pub deprovisioned: Vec<String>,
    pub errors: Vec<String>,
}

impl ReconcileSummary {
    fn record_error(&mut self, action: &str, slug: &str, e: &ProvisionError) {
        tracing::error!(error = %e, %slug, %action, "reconcile action failed");
        self.errors.push(format!("{action} {slug}: {e}"));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn desired(slug: &str, image: &str) -> DesiredTenant {
        DesiredTenant {
            slug: slug.into(),
            name: slug.into(),
            owner_keycloak_sub: "sub".into(),
            server_image: image.into(),
            web_image: "web:0".into(),
        }
    }

    fn real(slug: &str, image: &str) -> StoredWorkspace {
        StoredWorkspace {
            id: format!("keasy-ws-{slug}"),
            name: slug.into(),
            slug: slug.into(),
            url: format!("https://{slug}.x"),
            owner_keycloak_sub: "sub".into(),
            keycloak_uuid: format!("kc-{slug}"),
            server_image: image.into(),
            oidc_client_secret: "shh".into(),
        }
    }

    const DEFAULT_SERVER: &str = "server:default";
    const DEFAULT_WEB: &str = "web:default";

    #[test]
    fn provisions_missing_rolls_out_changed_and_keeps_self_serve() {
        let desired = vec![
            desired("acme", "server:1.0"),   // in sync (real has 1.0)
            desired("globex", "server:2.0"), // changed → rollout (real has 1.0)
            desired("initech", "server:1.0"),// missing → provision
        ];
        let real = vec![
            real("acme", "server:1.0"),
            real("globex", "server:1.0"),
            real("selfserve", DEFAULT_SERVER), // not in git, at default → KEPT, no action
        ];

        let actions = plan_reconcile(&desired, &real, DEFAULT_SERVER, DEFAULT_WEB);

        assert!(actions.contains(&ReconcileAction::Provision(desired[2].clone())));
        assert!(actions.contains(&ReconcileAction::Rollout {
            record: real[1].clone(),
            desired: desired[1].clone(),
        }));
        // The self-serve tenant (registry-only, at the default image) is left alone —
        // never reaped for being absent from git.
        assert!(!actions.iter().any(|a| matches!(
            a,
            ReconcileAction::Rollout { desired, .. } if desired.slug == "selfserve"
        )));
        assert_eq!(actions.len(), 2);
    }

    #[test]
    fn self_serve_tenant_rolls_to_default_not_reaped() {
        // A registry-only (API-created) tenant on an old image is rolled to the fleet
        // default — and crucially NOT deprovisioned for being absent from git.
        let real = vec![real("selfserve", "server:old")];
        let actions = plan_reconcile(&[], &real, DEFAULT_SERVER, DEFAULT_WEB);
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            ReconcileAction::Rollout { record, desired } => {
                assert_eq!(record.slug, "selfserve");
                assert_eq!(desired.server_image, DEFAULT_SERVER);
            }
            other => panic!("expected rollout, got {other:?}"),
        }
    }

    #[test]
    fn empty_desired_is_a_noop_when_in_sync() {
        // No git manifests + registry tenants already on the default image → nothing
        // happens (previously, empty desired reaped everything).
        let real = vec![real("acme", DEFAULT_SERVER), real("globex", DEFAULT_SERVER)];
        let actions = plan_reconcile(&[], &real, DEFAULT_SERVER, DEFAULT_WEB);
        assert!(actions.is_empty());
    }

    #[test]
    fn steady_state_is_a_noop() {
        let desired = vec![desired("acme", "server:1.0")];
        let real = vec![real("acme", "server:1.0")];
        assert!(plan_reconcile(&desired, &real, DEFAULT_SERVER, DEFAULT_WEB).is_empty());
    }
}
