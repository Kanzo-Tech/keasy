//! Instance-stack orchestration over Docker **Swarm**.
//!
//! Each workspace runs an isolated **Swarm stack** (`docker stack deploy -c <file>
//! <project>`) of a keasy-server + web service. The control-plane is the only
//! component with Docker socket access. Swarm — not the control-plane — owns the
//! generic ops: health-gated rolling updates (`deploy.update_config`), automatic
//! rollback (`failure_action: rollback`), and encrypted-at-rest secrets mounted at
//! `/run/secrets/<name>` (consumed by the server's `KEASY_*_FILE` support). Ingress
//! routing + TLS are delegated to **Traefik** via per-service `deploy.labels` — so
//! adding/removing a tenant needs no central proxy reconfiguration.
//!
//! Stacks are keyed by `docker stack deploy -p`… i.e. the project name is the
//! workspace id, so deploy and removal are idempotent.

use std::path::PathBuf;

use tokio::process::Command;
use uuid::Uuid;

use crate::config::ControlPlaneConfig;

/// The per-workspace parameters baked into the rendered stack file (non-secret).
pub struct StackSpec {
    /// Stable workspace id — the stack project name, the OIDC client_id, and the
    /// prefix of this workspace's Swarm secret + volume names.
    pub workspace_id: String,
    /// Display name (passed to the instance as `KEASY_WORKSPACE_NAME`).
    pub workspace_name: String,
    /// URL-safe slug, used for the `{slug}.{base_domain}` host (Traefik router).
    pub slug: String,
    /// keasy-server image for this instance (per-tenant pin; a rollout re-renders
    /// with a new value).
    pub server_image: String,
    /// web image for this instance.
    pub web_image: String,
}

/// Per-tenant secrets, created as Swarm secrets (encrypted in the Raft log) and
/// mounted into the server at `/run/secrets/<name>`. The control-plane mints these
/// once at provision; rollouts reference the existing secrets and never re-pass the
/// values. None of these is ever persisted by the control-plane outside Swarm.
pub struct TenantSecrets {
    /// OIDC client secret Keycloak generated for this workspace.
    pub oidc_client_secret: String,
    /// `KEASY_SESSION_SECRET` — session cookie signing key (generated).
    pub session_secret: String,
    /// `KEASY_API_KEY` — server API key (generated).
    pub api_key: String,
    /// `KEASY_SECRET_KEY` — encrypts stored tenant connection creds (generated).
    pub secret_key: String,
}

impl TenantSecrets {
    /// Mint the generated secrets for a fresh workspace; the OIDC secret comes from
    /// Keycloak (the only one the control-plane doesn't generate).
    pub fn mint(oidc_client_secret: impl Into<String>) -> Self {
        Self {
            oidc_client_secret: oidc_client_secret.into(),
            session_secret: random_secret(),
            api_key: random_secret(),
            secret_key: random_secret(),
        }
    }

    /// `(swarm-secret-suffix, value)` pairs. The full secret name is
    /// `<workspace_id>-<suffix>`.
    fn entries(&self) -> [(&'static str, &str); 4] {
        [
            ("oidc", &self.oidc_client_secret),
            ("session", &self.session_secret),
            ("api-key", &self.api_key),
            ("secret-key", &self.secret_key),
        ]
    }
}

/// A ~256-bit random secret (two v4 UUIDs of OS-random bytes, hex-encoded).
fn random_secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// Drives `docker stack`/`docker secret` for instance stacks. Holds the directory
/// where rendered stack files live (one per workspace, `<workspace_id>.yml`).
pub struct DockerOrchestrator {
    config: ControlPlaneConfig,
    stacks_dir: PathBuf,
}

impl DockerOrchestrator {
    /// Create an orchestrator writing rendered stack files under `stacks_dir`.
    pub fn new(config: ControlPlaneConfig, stacks_dir: impl Into<PathBuf>) -> Self {
        Self {
            config,
            stacks_dir: stacks_dir.into(),
        }
    }

    /// Create this workspace's Swarm secrets. Idempotent: a secret that already
    /// exists (Swarm secrets are immutable) is left as-is — rollouts reuse them.
    pub async fn create_secrets(
        &self,
        workspace_id: &str,
        secrets: &TenantSecrets,
    ) -> Result<(), String> {
        for (suffix, value) in secrets.entries() {
            let name = format!("{workspace_id}-{suffix}");
            // `docker secret create <name> -` reads the value from stdin so it
            // never lands in argv (visible in `ps`) or on disk.
            let out = Command::new("docker")
                .args(["secret", "create", &name, "-"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("spawn docker secret create: {e}"))?;
            use tokio::io::AsyncWriteExt;
            let mut child = out;
            if let Some(mut stdin) = child.stdin.take() {
                stdin
                    .write_all(value.as_bytes())
                    .await
                    .map_err(|e| format!("write secret to stdin: {e}"))?;
                stdin
                    .shutdown()
                    .await
                    .map_err(|e| format!("close secret stdin: {e}"))?;
            }
            let result = child
                .wait_with_output()
                .await
                .map_err(|e| format!("wait docker secret create: {e}"))?;
            if !result.status.success() {
                let stderr = String::from_utf8_lossy(&result.stderr);
                // An existing secret is fine (immutable, reused across rollouts).
                if stderr.contains("already exists") {
                    continue;
                }
                return Err(format!("docker secret create {name}: {stderr}"));
            }
        }
        Ok(())
    }

    /// Deploy (or roll out) the stack for `spec`. Idempotent: `docker stack deploy`
    /// reconciles to the desired state, recreating only changed services. Swarm's
    /// `update_config` (start-first + `failure_action: rollback`) health-gates the
    /// rollout — `--detach=false` blocks until the service converges (or rolls back).
    pub async fn deploy(&self, spec: &StackSpec) -> Result<(), String> {
        let file = self.render(spec)?;
        self.stack(
            &spec.workspace_id,
            &[
                "stack",
                "deploy",
                "--detach=false",
                "--with-registry-auth",
                "--resolve-image=always",
                "-c",
                &file.to_string_lossy(),
                &spec.workspace_id,
            ],
        )
        .await
    }

    /// Tear the stack down: remove the Swarm stack, its secrets, and its data
    /// volume. Idempotent — removing what does not exist is a no-op.
    pub async fn remove(&self, workspace_id: &str) -> Result<(), String> {
        // `docker stack rm` removes services + networks it owns, but NOT secrets or
        // volumes — those we remove explicitly.
        let _ = self
            .stack(workspace_id, &["stack", "rm", workspace_id])
            .await;
        for suffix in ["oidc", "session", "api-key", "secret-key"] {
            let _ = Command::new("docker")
                .args(["secret", "rm", &format!("{workspace_id}-{suffix}")])
                .output()
                .await;
        }
        let _ = Command::new("docker")
            .args(["volume", "rm", &format!("{workspace_id}-data")])
            .output()
            .await;
        let _ = std::fs::remove_file(self.stack_path(workspace_id));
        Ok(())
    }

    fn stack_path(&self, workspace_id: &str) -> PathBuf {
        self.stacks_dir.join(format!("{workspace_id}.yml"))
    }

    /// Render the stack template for `spec` to `<stacks_dir>/<id>.yml`.
    fn render(&self, spec: &StackSpec) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.stacks_dir)
            .map_err(|e| format!("create stacks dir: {e}"))?;
        let body = render_stack(&self.config, spec);
        let path = self.stack_path(&spec.workspace_id);
        std::fs::write(&path, body).map_err(|e| format!("write stack file: {e}"))?;
        Ok(path)
    }

    /// Run `docker <args...>`, mapping a non-zero exit to an error.
    async fn stack(&self, project: &str, args: &[&str]) -> Result<(), String> {
        let output = Command::new("docker")
            .args(args)
            .output()
            .await
            .map_err(|e| format!("failed to spawn docker: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "docker {} for {project} exited with {}: {}",
                args.first().copied().unwrap_or(""),
                output.status,
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }
}

/// Render the per-workspace Swarm stack. Keeps shared Keycloak + the edge overlay
/// external; defines only this workspace's server + web services, their Traefik
/// routers (so Traefik routes `{slug}.{base_domain}` to them with zero central
/// config), their Swarm-secret + volume mounts, and a health-gated `update_config`.
fn render_stack(cfg: &ControlPlaneConfig, spec: &StackSpec) -> String {
    let StackSpec {
        workspace_id,
        workspace_name,
        slug,
        server_image,
        web_image,
    } = spec;
    let base_domain = &cfg.base_domain;
    let issuer = &cfg.oidc_issuer_url;
    let internal = cfg.oidc_internal_base_url.as_deref().unwrap_or("");
    let network = &cfg.network;

    // Litestream durability is opt-in (CP_LITESTREAM_REPLICA_BASE). When set, the
    // server gets its per-tenant replica prefix + the shared `keasy-litestream`
    // creds secret; when not, these fragments are empty and the server runs with
    // no replication (the image's entrypoint falls back to running it directly).
    let (litestream_env, litestream_secret_ref, litestream_secret_def) =
        match &cfg.litestream_replica_base {
            Some(base) => (
                format!("\n      LITESTREAM_REPLICA_URL: \"{base}/{workspace_id}\""),
                ", litestream".to_string(),
                "\n  litestream:\n    external: true\n    name: keasy-litestream".to_string(),
            ),
            None => (String::new(), String::new(), String::new()),
        };

    format!(
        r#"# Rendered Swarm stack for workspace {workspace_id} — DO NOT EDIT.
# Generated by keasy-control-plane. Deploy: docker stack deploy -c this {workspace_id}
version: "3.9"

services:
  server:
    image: {server_image}
    environment:
      KEASY_BASE_URL: "https://{slug}.{base_domain}"
      KEASY_WORKSPACE_NAME: "{workspace_name}"
      KEASY_ORG_ALIAS: "{slug}"
      KEASY_OIDC_ISSUER_URL: "{issuer}"
      KEASY_OIDC_CLIENT_ID: "{workspace_id}"
      KEASY_OIDC_INTERNAL_BASE_URL: "{internal}"
      KEASY_OIDC_CLIENT_SECRET_FILE: /run/secrets/oidc
      KEASY_SESSION_SECRET_FILE: /run/secrets/session
      KEASY_API_KEY_FILE: /run/secrets/api-key
      KEASY_SECRET_KEY_FILE: /run/secrets/secret-key{litestream_env}
    secrets: [oidc, session, api-key, secret-key{litestream_secret_ref}]
    volumes:
      - data:/var/lib/keasy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/healthz/ready"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks: [edge]
    deploy:
      replicas: 1
      # Bound each tenant's blast radius: a single workspace can't starve the node.
      resources:
        limits:
          cpus: "1.0"
          memory: 1024M
      update_config:
        order: start-first
        failure_action: rollback
        monitor: 30s
        max_failure_ratio: 0
      rollback_config:
        order: start-first
      restart_policy:
        condition: any
      labels:
        com.keasy.workspace: "{workspace_id}"
        traefik.enable: "true"
        traefik.docker.network: "{network}"
        traefik.http.routers.{slug}-api.rule: "Host(`{slug}.{base_domain}`) && (PathPrefix(`/v1`) || PathPrefix(`/.well-known`))"
        traefik.http.routers.{slug}-api.entrypoints: "websecure"
        traefik.http.routers.{slug}-api.tls.certresolver: "le"
        traefik.http.routers.{slug}-api.service: "{slug}-api"
        traefik.http.services.{slug}-api.loadbalancer.server.port: "8080"

  web:
    image: {web_image}
    networks: [edge]
    deploy:
      replicas: 1
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
      update_config:
        order: start-first
        failure_action: rollback
        monitor: 30s
      restart_policy:
        condition: any
      labels:
        com.keasy.workspace: "{workspace_id}"
        traefik.enable: "true"
        traefik.docker.network: "{network}"
        traefik.http.routers.{slug}-web.rule: "Host(`{slug}.{base_domain}`)"
        traefik.http.routers.{slug}-web.entrypoints: "websecure"
        traefik.http.routers.{slug}-web.tls.certresolver: "le"
        traefik.http.routers.{slug}-web.priority: "1"
        traefik.http.routers.{slug}-web.service: "{slug}-web"
        traefik.http.services.{slug}-web.loadbalancer.server.port: "3000"

secrets:
  oidc:
    external: true
    name: {workspace_id}-oidc
  session:
    external: true
    name: {workspace_id}-session
  api-key:
    external: true
    name: {workspace_id}-api-key
  secret-key:
    external: true
    name: {workspace_id}-secret-key{litestream_secret_def}

volumes:
  data:
    name: {workspace_id}-data

networks:
  edge:
    external: true
    name: {network}
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ControlPlaneConfig {
        ControlPlaneConfig {
            oidc_issuer_url: "https://kc/realms/keasy".into(),
            oidc_client_id: "cp".into(),
            oidc_client_secret: secrecy::SecretString::from("s".to_string()),
            oidc_internal_base_url: Some("http://keycloak:8080".into()),
            base_domain: "keasy.app".into(),
            server_image: "default-server:latest".into(),
            web_image: "default-web:latest".into(),
            network: "keasy-edge".into(),
            litestream_replica_base: None,
        }
    }

    fn spec() -> StackSpec {
        StackSpec {
            workspace_id: "keasy-ws-1".into(),
            workspace_name: "Acme".into(),
            slug: "acme".into(),
            server_image: "ghcr.io/kanzo-tech/keasy-server:0.4.0".into(),
            web_image: "ghcr.io/kanzo-tech/keasy-web:0.4.0".into(),
        }
    }

    #[test]
    fn render_uses_per_tenant_images_not_config_defaults() {
        let out = render_stack(&cfg(), &spec());
        assert!(out.contains("image: ghcr.io/kanzo-tech/keasy-server:0.4.0"));
        assert!(out.contains("image: ghcr.io/kanzo-tech/keasy-web:0.4.0"));
        assert!(!out.contains("default-server:latest")); // config default NOT used
    }

    #[test]
    fn render_injects_required_secrets_so_the_server_can_boot() {
        let out = render_stack(&cfg(), &spec());
        // The FATAL-if-missing secrets are now wired as Swarm-secret files.
        assert!(out.contains("KEASY_SESSION_SECRET_FILE: /run/secrets/session"));
        assert!(out.contains("KEASY_API_KEY_FILE: /run/secrets/api-key"));
        assert!(out.contains("KEASY_SECRET_KEY_FILE: /run/secrets/secret-key"));
        assert!(out.contains("name: keasy-ws-1-session"));
    }

    #[test]
    fn render_routes_per_tenant_via_traefik_labels() {
        let out = render_stack(&cfg(), &spec());
        assert!(out.contains("traefik.http.routers.acme-api.rule: \"Host(`acme.keasy.app`)"));
        assert!(out.contains("traefik.http.routers.acme-web.rule: \"Host(`acme.keasy.app`)\""));
        assert!(out.contains("traefik.http.services.acme-api.loadbalancer.server.port: \"8080\""));
    }

    #[test]
    fn render_persists_data_and_health_gates_on_readiness() {
        let out = render_stack(&cfg(), &spec());
        assert!(out.contains("- data:/var/lib/keasy"));
        assert!(out.contains("name: keasy-ws-1-data"));
        assert!(out.contains("/healthz/ready"));
        assert!(out.contains("failure_action: rollback"));
        assert!(out.contains("order: start-first"));
    }

    #[test]
    fn litestream_is_off_by_default_and_wired_per_tenant_when_set() {
        // Unset → no replication wiring at all (server runs directly).
        let off = render_stack(&cfg(), &spec());
        assert!(!off.contains("LITESTREAM_REPLICA_URL"));
        assert!(!off.contains("keasy-litestream"));

        // Set → per-tenant replica prefix + the shared creds secret.
        let mut on_cfg = cfg();
        on_cfg.litestream_replica_base = Some("s3://keasy-backups/litestream".into());
        let on = render_stack(&on_cfg, &spec());
        assert!(on.contains("LITESTREAM_REPLICA_URL: \"s3://keasy-backups/litestream/keasy-ws-1\""));
        assert!(on.contains("secrets: [oidc, session, api-key, secret-key, litestream]"));
        assert!(on.contains("name: keasy-litestream"));
    }

    #[test]
    fn minted_secrets_are_distinct_and_nonempty() {
        let s = TenantSecrets::mint("oidc-from-kc");
        assert_eq!(s.oidc_client_secret, "oidc-from-kc");
        assert!(!s.session_secret.is_empty());
        assert_ne!(s.session_secret, s.api_key);
        assert_ne!(s.api_key, s.secret_key);
    }
}
