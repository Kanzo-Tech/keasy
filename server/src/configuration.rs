//! Everything the server is told, read from the environment: `KEASY_*`, and
//! `NAME_FILE` for a secret mounted as a file. The image carries no config
//! files.

use std::net::SocketAddr;
use std::path::PathBuf;

use secrecy::{ExposeSecret, SecretString};

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
    /// This instance's workspace slug. Read from `KEASY_ORG_ALIAS`. The "current"
    /// entry in the workspace switcher.
    pub workspace_slug: Option<String>,
    /// The credentials and connections to ensure at boot, in the API's own
    /// request format. Read from `KEASY_BOOTSTRAP_FILE`.
    pub bootstrap_file: Option<String>,
    /// How this instance looks: declared by the operator, the same for every
    /// visitor, public.
    pub branding: BrandingSettings,
}

/// An instance's look, declared in its deployment the way Grafana reads its
/// white-label settings from config and Keycloak deploys a theme per realm:
/// nothing a member edits in the app.
#[derive(Debug, Clone, Default)]
pub struct BrandingSettings {
    /// What the shell shows in place of the default mark: a URL, or a path the
    /// web serves. Read from `KEASY_BRANDING_LOGO`.
    pub logo: Option<String>,
    /// A theme stylesheet the web inlines on every page — the generator's
    /// export. Read from `KEASY_BRANDING_THEME_CSS`, or from the file
    /// `KEASY_BRANDING_THEME_CSS_FILE` names.
    pub theme_css: Option<String>,
    /// The theme names members may choose among; empty allows every theme.
    /// Read from `KEASY_BRANDING_THEMES`, comma-separated.
    pub themes: Vec<String>,
    /// The day theme. Read from `KEASY_BRANDING_DEFAULT_LIGHT`.
    pub default_light: Option<String>,
    /// The night theme. Read from `KEASY_BRANDING_DEFAULT_DARK`.
    pub default_dark: Option<String>,
    /// Members wear the defaults and choose nothing. Read from
    /// `KEASY_BRANDING_LOCK` (`true`/`false`, default `false`).
    pub lock: bool,
}

impl BrandingSettings {
    pub fn from_env() -> Result<Self, String> {
        let themes: Vec<String> = nonblank("KEASY_BRANDING_THEMES")
            .map(|list| {
                list.split(',')
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let lock = match nonblank("KEASY_BRANDING_LOCK").as_deref() {
            None | Some("false") => false,
            Some("true") => true,
            Some(other) => {
                return Err(format!(
                    "KEASY_BRANDING_LOCK is `true` or `false`, not {other:?}"
                ));
            }
        };
        let branding = Self {
            logo: nonblank("KEASY_BRANDING_LOGO"),
            theme_css: from_file_or_env("KEASY_BRANDING_THEME_CSS")?,
            themes,
            default_light: nonblank("KEASY_BRANDING_DEFAULT_LIGHT"),
            default_dark: nonblank("KEASY_BRANDING_DEFAULT_DARK"),
            lock,
        };
        branding.check()?;
        Ok(branding)
    }

    /// A default outside the allowed list would be a theme nobody may choose.
    pub fn check(&self) -> Result<(), String> {
        if self.themes.is_empty() {
            return Ok(());
        }
        for (var, theme) in [
            ("KEASY_BRANDING_DEFAULT_LIGHT", &self.default_light),
            ("KEASY_BRANDING_DEFAULT_DARK", &self.default_dark),
        ] {
            if let Some(theme) = theme
                && !self.themes.contains(theme)
            {
                return Err(format!(
                    "{var} is {theme:?}, which KEASY_BRANDING_THEMES does not allow"
                ));
            }
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
    /// This workspace's Keycloak client. Two jobs: the expected `azp` on every
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
        .ok_or("KEASY_OIDC_CLIENT_ID is required — it names this workspace's client")?;

    Ok(Settings {
        application: ApplicationSettings {
            bind_addr,
            workspace_name: nonblank("KEASY_WORKSPACE_NAME")
                .unwrap_or_else(|| "Workspace".to_string()),
            workspace_slug: nonblank("KEASY_ORG_ALIAS"),
            bootstrap_file: nonblank("KEASY_BOOTSTRAP_FILE"),
            branding: BrandingSettings::from_env()?,
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

    #[test]
    fn a_default_theme_must_be_one_members_may_choose() {
        let mut branding = BrandingSettings {
            themes: vec!["kanzo-light".into(), "kanzo-dark".into()],
            default_light: Some("kanzo-light".into()),
            ..Default::default()
        };
        assert!(branding.check().is_ok());
        branding.default_dark = Some("nord-dark".into());
        let err = branding.check().unwrap_err();
        assert!(err.contains("KEASY_BRANDING_DEFAULT_DARK"), "{err}");

        branding.themes.clear();
        assert!(branding.check().is_ok(), "no list allows every theme");
    }
}
