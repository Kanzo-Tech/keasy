use serde::Serialize;

/// The running build's version, so an operator can see which image a tenant is
/// on. `git_sha`/`built_at` are stamped at build time (CI sets `KEASY_GIT_SHA`/
/// `KEASY_BUILT_AT`); `version` is the crate version.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct VersionResponse {
    pub version: &'static str,
    pub git_sha: Option<&'static str>,
    pub built_at: Option<&'static str>,
}
