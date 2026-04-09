/// Newtype over org UUID string.
#[derive(Debug, Clone)]
pub struct OrgId(pub String);

impl OrgId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Org-scoped context for list/create operations.
#[derive(Debug, Clone)]
pub struct Tenant {
    pub org_id: OrgId,
}

/// Org-scoped context for single-resource operations.
#[derive(Debug)]
pub struct TenantResource<'a> {
    pub org_id: &'a OrgId,
    pub id: &'a str,
}
