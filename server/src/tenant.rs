/// Newtype over org UUID string.
#[derive(Debug, Clone)]
pub struct OrgId(pub String);

impl OrgId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A value `T` scoped to a specific organization.
/// DAL functions that list/detail resources MUST accept this type.
/// Construction is unrestricted in Phase 1; Phase 4 middleware will
/// be the sole constructor in production.
#[derive(Debug, Clone)]
pub struct TenantScoped<T> {
    pub org_id: OrgId,
    pub inner: T,
}

impl<T> TenantScoped<T> {
    pub fn new(org_id: OrgId, inner: T) -> Self {
        Self { org_id, inner }
    }

    pub fn org_id(&self) -> &OrgId {
        &self.org_id
    }

    pub fn inner(&self) -> &T {
        &self.inner
    }
}

/// Convenience: scoped unit — used when only org_id is needed (list queries).
pub type TenantContext = TenantScoped<()>;

impl TenantScoped<()> {
    /// Temporary placeholder using seed org. Phase 4 replaces this with real session context.
    pub fn placeholder() -> Self {
        Self::new(OrgId(crate::db::seed::SEED_ORG_ID.to_string()), ())
    }
}

impl<T: Clone> TenantScoped<T> {
    /// Temporary placeholder scoped with seed org around a value. Phase 4 replaces this.
    pub fn placeholder_with(inner: T) -> Self {
        Self::new(OrgId(crate::db::seed::SEED_ORG_ID.to_string()), inner)
    }
}

/// Convenience: create a placeholder TenantContext for route handlers.
/// Phase 4 replaces all call sites with real session context.
pub fn placeholder_ctx() -> TenantContext {
    TenantScoped::placeholder()
}

/// Convenience: create a placeholder TenantScoped<T> for route handlers.
/// Phase 4 replaces all call sites with real session context.
pub fn placeholder_scoped<T: Clone>(inner: T) -> TenantScoped<T> {
    TenantScoped::placeholder_with(inner)
}
