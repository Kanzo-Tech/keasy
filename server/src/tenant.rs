/// Newtype over the workspace UUID string. Carried by `TenantContext` and used
/// by the workspace-management surface (members, invites, identity). Resource
/// data is not org-scoped (W8 flatten) — one workspace owns the whole instance.
#[derive(Debug, Clone)]
pub struct OrgId(pub String);

impl OrgId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Re-export the real TenantContext from middleware::tenant.
pub use crate::middleware::tenant::TenantContext;
