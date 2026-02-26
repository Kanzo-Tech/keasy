---
phase: 04-tenant-context-middleware-rbac
plan: "01"
subsystem: server/middleware
tags: [rbac, tenant-context, middleware, auth, dataspace]
dependency_graph:
  requires: []
  provides: [TenantContext, TenantRole, RbacError, tenant_context_required, set-active-dataspace, get-me, get_org_dataspace_role]
  affects: [server/src/middleware, server/src/auth/routes.rs, server/src/routes/mod.rs, server/src/db/dataspaces.rs, server/src/tenant.rs]
tech_stack:
  added: [thiserror (RbacError), axum::extract::FromRequestParts (custom extractors)]
  patterns: [middleware injection via request extensions, RBAC extractor pattern, flat role enum, opaque 403 responses]
key_files:
  created:
    - server/src/middleware/tenant.rs
  modified:
    - server/src/middleware/mod.rs
    - server/src/tenant.rs
    - server/src/db/dataspaces.rs
    - server/src/auth/routes.rs
    - server/src/routes/mod.rs
    - server/src/jobs/db.rs
    - server/src/connections/db.rs
    - server/src/ai/db.rs
    - server/src/cloud/db.rs
decisions:
  - "DAL methods that accepted &TenantContext (old alias = TenantScoped<()>) updated to use &TenantScoped<()> explicitly to avoid name collision with new TenantContext struct"
  - "tenant.rs re-exports new TenantContext via pub use; placeholder_ctx/placeholder_scoped kept for Plan 03 migration"
  - "tenant_context_required uses axum::http::Request<axum::body::Body> explicitly (axum requires generic parameter)"
metrics:
  duration: "~15 min"
  completed_date: "2026-02-26"
  tasks_completed: 2
  files_created: 1
  files_modified: 9
---

# Phase 4 Plan 01: TenantContext Foundation Summary

**One-liner:** TenantContext struct with flat TenantRole enum, opaque RbacError, RBAC extractors (RequireRole/RequirePromotor/RequireOrgAdmin), tenant_context_required middleware, POST /v1/auth/set-dataspace and GET /v1/auth/me endpoints wired into router

## What Was Built

### middleware/tenant.rs (new, 200+ lines)
- `TenantContext` struct: `org_id: OrgId`, `dataspace_id: String`, `role: TenantRole`
- `TenantRole` enum: `Promotor`, `OrgAdmin`, `OrgUser` (flat, no hierarchy)
- `RbacError` enum via thiserror: `AuthRequired` (401), `NoActiveDataspace`/`NoMembership` (same opaque 403), `InsufficientRole` (403), `Internal` (500)
- `RequireRole`, `RequirePromotor`, `RequireOrgAdmin` extractors implementing `FromRequestParts`
- `tenant_context_required` middleware: extracts AuthenticatedUser from extensions, reads active_dataspace_id from session, resolves org membership + dataspace role, constructs TenantContext and injects into request extensions

### db/dataspaces.rs (extended)
- Added `get_org_dataspace_role(&self, org_id, dataspace_id) -> Option<DataspaceRole>`

### auth/routes.rs (extended)
- `SetDataspaceRequest` struct (deserializable)
- `set_active_dataspace` handler: validates org membership in dataspace, stores `active_dataspace_id` in session, returns 204
- `get_me` handler: returns user profile, org, available dataspaces, active_dataspace_id

### routes/mod.rs (extended)
- `session_auth_routes`: groups logout + set-dataspace + me under `session_required` only
- `api_routes`: now has two layers — `session_required` (outer) then `tenant_context_required` (inner)

### tenant.rs (modified)
- Removed `pub type TenantContext = TenantScoped<()>;`
- Added `pub use crate::middleware::tenant::TenantContext;` re-export
- Kept `placeholder_ctx()` returning `TenantScoped<()>` for backward compatibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DAL files used TenantContext (old alias) in method signatures**
- **Found during:** Task 1 — cargo check after creating middleware/tenant.rs
- **Issue:** 4 DAL files (jobs/db.rs, connections/db.rs, ai/db.rs, cloud/db.rs) imported `TenantContext` from `tenant.rs` where it was an alias for `TenantScoped<()>`. After re-exporting the new TenantContext struct, these signatures mismatched.
- **Fix:** Updated all 4 DAL files to use `TenantScoped<()>` explicitly in imports and function signatures
- **Files modified:** server/src/jobs/db.rs, server/src/connections/db.rs, server/src/ai/db.rs, server/src/cloud/db.rs
- **Commit:** 52bebc1

**2. [Rule 3 - Blocking] axum::http::Request requires explicit generic parameter**
- **Found during:** Task 1 — cargo check
- **Issue:** `Request` in middleware signature requires `Request<Body>` not bare `Request`
- **Fix:** Used `axum::http::Request<axum::body::Body>` in tenant_context_required signature; removed unused `use axum::http::Request` import
- **Files modified:** server/src/middleware/tenant.rs
- **Commit:** 52bebc1

## Verification Results

- `cargo check`: PASSED
- `cargo clippy -- -D warnings`: PASSED (clean)
- `cargo test`: PASSED (2/2 auth_smoke tests)
- `middleware/tenant.rs`: TenantContext struct, TenantRole enum, RbacError, RequireRole/RequirePromotor/RequireOrgAdmin, tenant_context_required all present
- `auth/routes.rs`: set_active_dataspace and get_me handlers present
- `routes/mod.rs`: tenant_context_required layer on api_routes, session_auth_routes grouping
- `db/dataspaces.rs`: get_org_dataspace_role present

## Self-Check: PASSED
