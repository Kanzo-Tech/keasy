//! Everything the server is told, read from the environment: `KEASY_*`, and
//! `NAME_FILE` for a secret mounted as a file. The image carries no config
//! files.

use std::net::SocketAddr;
use std::path::PathBuf;

use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};

use crate::credentials::sealing::SecretKey;

pub struct Settings {
    pub application: ApplicationSettings,
    pub database: DatabaseSettings,
    pub oidc: OidcSettings,
}

pub struct ApplicationSettings {
    /// Read from `KEASY_BIND_ADDR`, default `0.0.0.0:8080`. Port 0 binds a
    /// free port, which [`crate::startup::Application::port`] reports.
    pub bind_addr: SocketAddr,
    /// Display name of this workspace. Read from `KEASY_WORKSPACE_NAME`,
    /// default `"Workspace"`. The switcher's name for this instance.
    pub workspace_name: String,
    /// The Keycloak organization this instance serves, by alias. Read from
    /// `KEASY_ORG_ALIAS`, required: a token's roles count only inside it.
    pub org_alias: String,
    /// The credentials and connections to ensure at boot, in the API's own
    /// request format. Read from `KEASY_BOOTSTRAP_FILE`.
    pub bootstrap_file: Option<String>,
    /// How this instance looks: declared by the operator, the same for every
    /// visitor, public.
    pub branding: BrandingSettings,
    /// Each caller's allowance. Not read from the environment: [`Rate::BUILT`].
    pub rate: Rate,
}

/// A caller's allowance: one request back every `period_ms`, up to `burst` held.
#[derive(Clone, Copy)]
pub struct Rate {
    pub period_ms: u64,
    pub burst: u32,
}

impl Rate {
    /// Per caller: 20 requests a second, bursts of 100.
    pub const RELEASE: Rate = Rate {
        period_ms: 50,
        burst: 100,
    };

    /// Relaxed in a debug build, where one person drives every request a page makes.
    pub const DEBUG: Rate = Rate {
        period_ms: 10,
        burst: 500,
    };

    /// The allowance this build serves with.
    pub const BUILT: Rate = if cfg!(debug_assertions) {
        Rate::DEBUG
    } else {
        Rate::RELEASE
    };
}

/// An instance's look, declared in its deployment the way Grafana reads its
/// white-label settings from config and Keycloak deploys a theme per realm:
/// nothing a member edits in the app.
///
/// Read from the YAML file `KEASY_BRANDING_FILE` names: exactly the snippet
/// kanzo-ui's theme generator emits, under a top-level `branding:` key, plus an
/// optional `logo`. No file, no branding: every shipped theme, the web's own
/// defaults, nothing locked.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrandingSettings {
    /// What the shell shows in place of the default mark: a URL, or a path the
    /// web serves.
    pub logo: Option<String>,
    /// The generator's theme stylesheet, inlined on every page.
    pub theme_css: Option<String>,
    /// The theme families members may choose among; empty allows every
    /// shipped theme.
    #[serde(default)]
    pub families: Vec<ThemeFamily>,
    /// The family a visitor starts with; absent leaves the web's own.
    pub default: Option<String>,
    /// Members wear the default and choose nothing.
    #[serde(default)]
    pub lock: bool,
}

/// A theme as a pair: what it is called by day and by night.
#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ThemeFamily {
    pub family: String,
    pub light: ThemeChoice,
    pub dark: ThemeChoice,
}

/// One theme: the `data-theme` value it is selected by, and its display name.
#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ThemeChoice {
    pub value: String,
    pub label: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BrandingFile {
    branding: BrandingSettings,
}

impl BrandingSettings {
    pub fn from_env() -> Result<Self, String> {
        let Some(path) = nonblank("KEASY_BRANDING_FILE") else {
            return Ok(Self::default());
        };
        let yaml = std::fs::read_to_string(&path).map_err(|e| {
            format!("KEASY_BRANDING_FILE points to {path} but could not read it: {e}")
        })?;
        Self::from_yaml(&yaml).map_err(|e| format!("KEASY_BRANDING_FILE ({path}): {e}"))
    }

    /// The generator's snippet, checked.
    pub fn from_yaml(yaml: &str) -> Result<Self, String> {
        let BrandingFile { mut branding } =
            serde_norway::from_str(yaml).map_err(|e| e.to_string())?;
        let blank = |s: &Option<String>| s.as_deref().is_none_or(|s| s.trim().is_empty());
        if blank(&branding.logo) {
            branding.logo = None;
        }
        if blank(&branding.theme_css) {
            branding.theme_css = None;
        }
        branding.check()?;
        Ok(branding)
    }

    /// Every family names both its themes, and a default is one members may
    /// choose.
    fn check(&self) -> Result<(), String> {
        for f in &self.families {
            if f.family.trim().is_empty() {
                return Err("a family in branding.families has no name".into());
            }
            for (side, choice) in [("light", &f.light), ("dark", &f.dark)] {
                if choice.value.trim().is_empty() || choice.label.trim().is_empty() {
                    return Err(format!(
                        "branding.families {:?}: {side} needs a value and a label",
                        f.family
                    ));
                }
            }
        }
        if let Some(default) = &self.default
            && !self.families.is_empty()
            && !self.families.iter().any(|f| &f.family == default)
        {
            return Err(format!(
                "branding.default is {default:?}, which is not among branding.families"
            ));
        }
        Ok(())
    }
}

pub struct DatabaseSettings {
    /// Read from `KEASY_DATA_DIR`, default `./data`.
    pub data_dir: PathBuf,
    /// Seals every stored credential. Required: there is no plaintext mode.
    pub secret_key: SecretKey,
}

impl DatabaseSettings {
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            data_dir: PathBuf::from(
                std::env::var("KEASY_DATA_DIR").unwrap_or_else(|_| "./data".to_string()),
            ),
            secret_key: secret_key("KEASY_SECRET_KEY")?,
        })
    }

    /// The instance database file.
    pub fn path(&self) -> PathBuf {
        self.data_dir.join("keasy.db")
    }
}

pub struct OidcSettings {
    /// The **public** OIDC issuer, exactly as it appears in a token's `iss`.
    /// Read from KEASY_OIDC_ISSUER_URL. Example: https://auth.example/auth/realms/keasy
    pub issuer_url: String,
    /// This workspace's Keycloak client. Two graphs: the expected `azp` on every
    /// token, and the key into `resource_access` that carries the roles.
    /// Read from KEASY_OIDC_CLIENT_ID. Example: keasy-ws-dev
    pub client_id: String,
    /// This API's audience — what the tenant client's audience mapper names, and
    /// what `aud` must contain. Read from KEASY_OIDC_AUDIENCE, default "keasy-api".
    pub audience: String,
    /// The **origin** at which this process reaches Keycloak, when that is not
    /// where the browser reaches it (`http://keycloak:8080`). Only the origin is
    /// replaced; the issuer's path is its own.
    /// Read from KEASY_OIDC_INTERNAL_BASE_URL.
    pub internal_base_url: Option<String>,
}

pub fn get_configuration() -> Result<Settings, String> {
    let bind_addr = std::env::var("KEASY_BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .map_err(|e| format!("KEASY_BIND_ADDR is not a socket address: {e}"))?;

    // There is no unauthenticated mode to fall back to: a resource server that
    // cannot name its issuer cannot refuse anything.
    let issuer_url = nonblank("KEASY_OIDC_ISSUER_URL")
        .ok_or("KEASY_OIDC_ISSUER_URL is required — it is what tokens are validated against")?;
    let client_id = nonblank("KEASY_OIDC_CLIENT_ID")
        .ok_or("KEASY_OIDC_CLIENT_ID is required — it names this application's client")?;

    Ok(Settings {
        application: ApplicationSettings {
            bind_addr,
            workspace_name: nonblank("KEASY_WORKSPACE_NAME")
                .unwrap_or_else(|| "Workspace".to_string()),
            org_alias: nonblank("KEASY_ORG_ALIAS").ok_or(
                "KEASY_ORG_ALIAS is required — it names the organization this instance serves",
            )?,
            bootstrap_file: nonblank("KEASY_BOOTSTRAP_FILE"),
            branding: BrandingSettings::from_env()?,
            rate: Rate::BUILT,
        },
        database: DatabaseSettings::from_env()?,
        oidc: OidcSettings {
            issuer_url,
            client_id,
            audience: nonblank("KEASY_OIDC_AUDIENCE").unwrap_or_else(|| "keasy-api".to_string()),
            internal_base_url: nonblank("KEASY_OIDC_INTERNAL_BASE_URL"),
        },
    })
}

/// The sealing key in `name` (or the file `name_FILE` points to).
pub fn secret_key(name: &str) -> Result<SecretKey, String> {
    match resolve_secret(name)? {
        Some(encoded) => SecretKey::from_base64(encoded.expose_secret()).map_err(|e| {
            format!("{name} must be 32 random bytes in base64 (openssl rand -base64 32): it {e}")
        }),
        None => Err(format!(
            "{name} is required to seal stored credentials \
             (generate one with: openssl rand -base64 32)"
        )),
    }
}

/// An environment variable, or `None` when it is absent or blank.
fn nonblank(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `NAME_FILE` (a mounted secret) if set, else `NAME`.
fn resolve_secret(name: &str) -> Result<Option<SecretString>, String> {
    Ok(from_file_or_env(name)?.map(SecretString::from))
}

/// The contents of the file `NAME_FILE` names if it is set, else `NAME`;
/// `None` when blank.
fn from_file_or_env(name: &str) -> Result<Option<String>, String> {
    let file_var = format!("{name}_FILE");
    if let Ok(path) = std::env::var(&file_var) {
        let contents = std::fs::read_to_string(&path)
            .map_err(|e| format!("{file_var} points to {path} but could not read it: {e}"))?;
        return Ok(Some(contents.trim().to_string()).filter(|s| !s.is_empty()));
    }
    Ok(nonblank(name))
}

#[cfg(test)]
mod tests {
    use super::BrandingSettings;

    const GENERATED: &str = r#"
branding:
  theme_css: |
    /* @family acme */
    [data-theme="acme"] { --primary: oklch(0.6 0.2 30); }
    [data-theme="acme-dark"] { --primary: oklch(0.7 0.2 30); }
  families:
    - family: acme
      light: { value: acme, label: Acme }
      dark: { value: acme-dark, label: Acme Dark }
  default: acme
  lock: false
"#;

    #[test]
    fn the_generators_snippet_is_read_as_is() {
        let b = BrandingSettings::from_yaml(GENERATED).unwrap();
        assert!(b.theme_css.unwrap().contains(r#"[data-theme="acme-dark"]"#));
        assert_eq!(b.families.len(), 1);
        assert_eq!(b.families[0].dark.value, "acme-dark");
        assert_eq!(b.families[0].dark.label, "Acme Dark");
        assert_eq!(b.default.as_deref(), Some("acme"));
        assert!(!b.lock);
        assert!(b.logo.is_none());
    }

    #[test]
    fn the_dev_example_is_valid() {
        let b = BrandingSettings::from_yaml(include_str!("../../infra/dev/branding.example.yml"))
            .unwrap();
        assert_eq!(b.default.as_deref(), Some("acme"));
    }

    #[test]
    fn a_logo_rides_along_and_everything_else_is_optional() {
        let b = BrandingSettings::from_yaml("branding:\n  logo: /acme.svg\n").unwrap();
        assert_eq!(b.logo.as_deref(), Some("/acme.svg"));
        assert!(b.families.is_empty() && b.default.is_none() && !b.lock);
    }

    #[test]
    fn the_default_must_be_a_family_members_may_choose() {
        let err = BrandingSettings::from_yaml(&GENERATED.replace("default: acme", "default: nord"))
            .unwrap_err();
        assert!(err.contains("branding.default"), "{err}");

        let free = "branding:\n  default: nord\n";
        assert!(
            BrandingSettings::from_yaml(free).is_ok(),
            "no list allows every theme"
        );
    }

    #[test]
    fn a_family_names_both_its_themes() {
        let err =
            BrandingSettings::from_yaml(&GENERATED.replace("label: Acme Dark", "label: \"\""))
                .unwrap_err();
        assert!(err.contains("dark needs a value and a label"), "{err}");

        let missing = GENERATED.replace("      dark: { value: acme-dark, label: Acme Dark }\n", "");
        assert!(BrandingSettings::from_yaml(&missing).is_err());
    }

    #[test]
    fn lock_is_a_bool_and_typos_are_refused() {
        assert!(
            BrandingSettings::from_yaml(&GENERATED.replace("lock: false", "lock: maybe")).is_err()
        );
        assert!(
            BrandingSettings::from_yaml(&GENERATED.replace("lock: false", "lok: true")).is_err()
        );
        assert!(
            BrandingSettings::from_yaml("theme_css: x\n").is_err(),
            "the branding: key is required"
        );
    }
}
