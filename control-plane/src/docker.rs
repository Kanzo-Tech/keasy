//! Instance-stack orchestration over the Docker socket.
//!
//! Each workspace runs an isolated stack (a keasy-server + web container) brought
//! up from a **parameterized compose template**. The control-plane is the only
//! component with Docker socket access; `docker compose` talks to the Engine API
//! under the hood. Stacks are keyed by `docker compose -p <project>` where the
//! project name is the workspace id, so teardown and re-provision are idempotent.

use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::config::ControlPlaneConfig;

/// The per-workspace parameters baked into the rendered compose file.
pub struct StackSpec {
    /// Stable workspace id — also the compose project name and the instance's
    /// OIDC client_id (workspace identity).
    pub workspace_id: String,
    /// Display name (passed to the instance as `KEASY_WORKSPACE_NAME`).
    pub workspace_name: String,
    /// URL-safe slug, used for the `{slug}.{base_domain}` host.
    pub slug: String,
    /// OIDC client secret Keycloak generated for this workspace.
    pub oidc_client_secret: String,
    /// keasy-server image for this instance (per-tenant pin; a rollout re-renders
    /// with a new value). Falls back to the env default at the call site.
    pub server_image: String,
    /// web image for this instance.
    pub web_image: String,
}

/// Drives `docker compose` for instance stacks. Holds the directory where
/// rendered compose files live (one per workspace, named `<workspace_id>.yml`).
pub struct DockerOrchestrator {
    config: ControlPlaneConfig,
    stacks_dir: PathBuf,
}

impl DockerOrchestrator {
    /// Create an orchestrator writing rendered compose files under `stacks_dir`.
    pub fn new(config: ControlPlaneConfig, stacks_dir: impl Into<PathBuf>) -> Self {
        Self {
            config,
            stacks_dir: stacks_dir.into(),
        }
    }

    /// Bring up (or reconcile) the stack for `spec`. Idempotent: `docker compose
    /// up -d` on an already-running project is a no-op for unchanged services and
    /// recreates only the services whose image/config changed (a rollout). `--wait`
    /// makes it health-gated: it blocks until the instance's healthcheck passes (or
    /// fails the rollout) rather than returning the moment the container starts.
    pub async fn up(&self, spec: &StackSpec) -> Result<(), String> {
        let file = self.render(spec)?;
        self.compose(
            &spec.workspace_id,
            &file,
            &["up", "-d", "--remove-orphans", "--wait", "--wait-timeout", "120"],
        )
        .await
    }

    /// Tear the stack down and remove its volumes. Idempotent: tearing down a
    /// project that does not exist is a no-op.
    pub async fn down(&self, workspace_id: &str) -> Result<(), String> {
        let file = self.compose_path(workspace_id);
        if !file.exists() {
            return Ok(());
        }
        self.compose(workspace_id, &file, &["down", "--volumes"])
            .await?;
        let _ = std::fs::remove_file(&file);
        Ok(())
    }

    fn compose_path(&self, workspace_id: &str) -> PathBuf {
        self.stacks_dir.join(format!("{workspace_id}.yml"))
    }

    /// Render the compose template for `spec` to `<stacks_dir>/<id>.yml`.
    fn render(&self, spec: &StackSpec) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.stacks_dir)
            .map_err(|e| format!("create stacks dir: {e}"))?;
        let body = render_compose(&self.config, spec);
        let path = self.compose_path(&spec.workspace_id);
        std::fs::write(&path, body).map_err(|e| format!("write compose file: {e}"))?;
        Ok(path)
    }

    /// Run `docker compose -p <project> -f <file> <args...>`.
    async fn compose(&self, project: &str, file: &Path, args: &[&str]) -> Result<(), String> {
        let status = Command::new("docker")
            .arg("compose")
            .arg("-p")
            .arg(project)
            .arg("-f")
            .arg(file)
            .args(args)
            .status()
            .await
            .map_err(|e| format!("failed to spawn docker compose: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "docker compose {} exited with {status}",
                args.join(" ")
            ))
        }
    }
}

/// Render the parameterized instance compose file. Keeps the shared Keycloak +
/// network external; only the per-workspace server + web are defined.
fn render_compose(cfg: &ControlPlaneConfig, spec: &StackSpec) -> String {
    let StackSpec {
        workspace_id,
        workspace_name,
        slug,
        oidc_client_secret,
        server_image,
        web_image,
    } = spec;
    let base_domain = &cfg.base_domain;
    let issuer = &cfg.oidc_issuer_url;
    let internal = cfg.oidc_internal_base_url.as_deref().unwrap_or("");
    let network = &cfg.network;
    format!(
        r#"# Rendered instance stack for workspace {workspace_id} — DO NOT EDIT.
# Generated by keasy-control-plane.
services:
  server:
    image: {server_image}
    restart: unless-stopped
    environment:
      KEASY_BASE_URL: "https://{slug}.{base_domain}"
      KEASY_WORKSPACE_NAME: "{workspace_name}"
      KEASY_ORG_ALIAS: "{slug}"
      KEASY_OIDC_ISSUER_URL: "{issuer}"
      KEASY_OIDC_CLIENT_ID: "{workspace_id}"
      KEASY_OIDC_CLIENT_SECRET: "{oidc_client_secret}"
      KEASY_OIDC_INTERNAL_BASE_URL: "{internal}"
    # Health-gates `up --wait`: a rollout only succeeds once the new image is live.
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/healthz/live"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks: [shared]
  web:
    image: {web_image}
    restart: unless-stopped
    depends_on: [server]
    networks: [shared]

networks:
  shared:
    name: {network}
    external: true
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ControlPlaneConfig {
        ControlPlaneConfig {
            bind_addr: "0.0.0.0:9000".into(),
            oidc_issuer_url: "https://kc/realms/keasy".into(),
            oidc_client_id: "cp".into(),
            oidc_client_secret: secrecy::SecretString::from("s".to_string()),
            oidc_internal_base_url: Some("http://keycloak:8080".into()),
            base_domain: "keasy.app".into(),
            server_image: "default-server:latest".into(),
            web_image: "default-web:latest".into(),
            network: "keasy_default".into(),
        }
    }

    #[test]
    fn render_uses_per_tenant_images_not_config_defaults() {
        let spec = StackSpec {
            workspace_id: "keasy-ws-1".into(),
            workspace_name: "Acme".into(),
            slug: "acme".into(),
            oidc_client_secret: "secret".into(),
            server_image: "ghcr.io/kanzo-tech/keasy-server:0.4.0".into(),
            web_image: "ghcr.io/kanzo-tech/keasy-web:0.4.0".into(),
        };
        let out = render_compose(&cfg(), &spec);
        assert!(out.contains("image: ghcr.io/kanzo-tech/keasy-server:0.4.0"));
        assert!(out.contains("image: ghcr.io/kanzo-tech/keasy-web:0.4.0"));
        assert!(!out.contains("default-server:latest")); // config default NOT used
        assert!(out.contains("https://acme.keasy.app"));
        assert!(out.contains("healthcheck:"));
    }
}
