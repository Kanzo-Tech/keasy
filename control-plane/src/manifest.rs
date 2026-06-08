//! The declarative source of truth for which workspaces should exist.
//!
//! An environment is a directory:
//!
//! ```text
//! deploy/environments/<env>/
//!   versions.env            # KEASY_SERVER_IMAGE=…  KEASY_WEB_IMAGE=…  (the rollout pin)
//!   tenants/
//!     acme.yaml             # one file per workspace; filename stem = default slug
//!     globex.yaml
//! ```
//!
//! Git history of this directory is the audit log: adding a tenant file provisions
//! it, deleting it deprovisions it, and bumping `versions.env` rolls every tenant
//! to the new image. [`load_environment`] reads it into the desired state the
//! reconciler diffs against the live registry.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

/// A workspace the manifest says should exist, with images already resolved
/// (per-tenant override falling back to the environment's `versions.env`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesiredTenant {
    pub slug: String,
    pub name: String,
    pub owner_keycloak_sub: String,
    pub server_image: String,
    pub web_image: String,
}

/// On-disk per-tenant spec (`tenants/<slug>.yaml`). Images are optional overrides.
#[derive(Deserialize)]
struct TenantFile {
    name: String,
    owner_keycloak_sub: String,
    slug: Option<String>,
    server_image: Option<String>,
    web_image: Option<String>,
}

/// Environment-wide image pins from `versions.env`.
struct Versions {
    server_image: String,
    web_image: String,
}

/// Load an environment directory into the desired tenant set (sorted by slug).
pub fn load_environment(dir: &Path) -> Result<Vec<DesiredTenant>, String> {
    let versions = parse_versions(
        &std::fs::read_to_string(dir.join("versions.env"))
            .map_err(|e| format!("read versions.env: {e}"))?,
    )?;

    let tenants_dir = dir.join("tenants");
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&tenants_dir)
        .map_err(|e| format!("read {}: {e}", tenants_dir.display()))?;
    for entry in entries {
        let path = entry.map_err(|e| format!("dir entry: {e}"))?.path();
        let is_yaml = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e == "yaml" || e == "yml");
        if !is_yaml {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| format!("bad tenant filename: {}", path.display()))?
            .to_string();
        let body =
            std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        out.push(
            parse_tenant(&body, &stem, &versions)
                .map_err(|e| format!("{}: {e}", path.display()))?,
        );
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}

/// Parse a `KEY=VALUE` env file, ignoring blanks and `#` comments.
fn parse_versions(body: &str) -> Result<Versions, String> {
    let mut map = BTreeMap::new();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (k, v) = line
            .split_once('=')
            .ok_or_else(|| format!("malformed versions.env line: {line:?}"))?;
        map.insert(k.trim().to_string(), v.trim().to_string());
    }
    let get = |k: &str| -> Result<String, String> {
        map.get(k)
            .filter(|v| !v.is_empty())
            .cloned()
            .ok_or_else(|| format!("versions.env missing {k}"))
    };
    Ok(Versions {
        server_image: get("KEASY_SERVER_IMAGE")?,
        web_image: get("KEASY_WEB_IMAGE")?,
    })
}

/// Parse one tenant YAML, resolving images against the environment defaults.
/// `default_slug` is the filename stem, used when the file omits `slug`.
fn parse_tenant(body: &str, default_slug: &str, versions: &Versions) -> Result<DesiredTenant, String> {
    let f: TenantFile = serde_yaml_ng::from_str(body).map_err(|e| format!("parse: {e}"))?;
    Ok(DesiredTenant {
        slug: f.slug.unwrap_or_else(|| default_slug.to_string()),
        name: f.name,
        owner_keycloak_sub: f.owner_keycloak_sub,
        server_image: f.server_image.unwrap_or_else(|| versions.server_image.clone()),
        web_image: f.web_image.unwrap_or_else(|| versions.web_image.clone()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn versions() -> Versions {
        Versions {
            server_image: "ghcr.io/kanzo-tech/keasy-server:0.3.0".into(),
            web_image: "ghcr.io/kanzo-tech/keasy-web:0.3.0".into(),
        }
    }

    #[test]
    fn versions_env_parses_and_ignores_comments() {
        let v = parse_versions(
            "# pin\nKEASY_SERVER_IMAGE=ghcr.io/x/server:1.0\n\nKEASY_WEB_IMAGE = ghcr.io/x/web:1.0\n",
        )
        .unwrap();
        assert_eq!(v.server_image, "ghcr.io/x/server:1.0");
        assert_eq!(v.web_image, "ghcr.io/x/web:1.0"); // trimmed around '='
    }

    #[test]
    fn versions_env_missing_key_errors() {
        assert!(parse_versions("KEASY_SERVER_IMAGE=x").is_err());
    }

    #[test]
    fn tenant_inherits_env_images() {
        let t = parse_tenant(
            "name: Acme Corp\nowner_keycloak_sub: sub-1\n",
            "acme",
            &versions(),
        )
        .unwrap();
        assert_eq!(
            t,
            DesiredTenant {
                slug: "acme".into(),
                name: "Acme Corp".into(),
                owner_keycloak_sub: "sub-1".into(),
                server_image: "ghcr.io/kanzo-tech/keasy-server:0.3.0".into(),
                web_image: "ghcr.io/kanzo-tech/keasy-web:0.3.0".into(),
            }
        );
    }

    #[test]
    fn load_environment_reads_dir_skipping_non_tenant_files() {
        let dir = tempfile::tempdir().unwrap();
        let env = dir.path();
        std::fs::write(
            env.join("versions.env"),
            "KEASY_SERVER_IMAGE=s:1\nKEASY_WEB_IMAGE=w:1\n",
        )
        .unwrap();
        let tenants = env.join("tenants");
        std::fs::create_dir_all(&tenants).unwrap();
        std::fs::write(tenants.join("acme.yaml"), "name: Acme\nowner_keycloak_sub: sub-a\n").unwrap();
        std::fs::write(
            tenants.join("globex.yml"), // .yml extension + image override
            "name: Globex\nowner_keycloak_sub: sub-g\nserver_image: s:2\n",
        )
        .unwrap();
        std::fs::write(tenants.join("template.yaml.example"), "name: nope\n").unwrap();
        std::fs::write(tenants.join("README.md"), "ignored").unwrap();

        let desired = load_environment(env).unwrap();

        assert_eq!(desired.len(), 2); // .example + README skipped
        assert_eq!(desired[0].slug, "acme"); // sorted by slug
        assert_eq!(desired[0].server_image, "s:1"); // inherits versions.env
        assert_eq!(desired[1].slug, "globex"); // slug from .yml filename stem
        assert_eq!(desired[1].server_image, "s:2"); // per-tenant override
        assert_eq!(desired[1].web_image, "w:1"); // still inherits
    }

    #[test]
    fn tenant_can_override_slug_and_image_for_canary() {
        let t = parse_tenant(
            "name: Globex\nowner_keycloak_sub: sub-2\nslug: globex-eu\nserver_image: ghcr.io/kanzo-tech/keasy-server:0.4.0-rc.1\n",
            "globex",
            &versions(),
        )
        .unwrap();
        assert_eq!(t.slug, "globex-eu"); // explicit slug wins over filename
        assert_eq!(t.server_image, "ghcr.io/kanzo-tech/keasy-server:0.4.0-rc.1"); // canary override
        assert_eq!(t.web_image, "ghcr.io/kanzo-tech/keasy-web:0.3.0"); // still inherits
    }
}
