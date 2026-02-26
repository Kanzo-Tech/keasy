---
phase: 04-tenant-context-middleware-rbac
plan: "02"
subsystem: server/routes,server/dal
tags: [rbac, tenant-isolation, multi-tenant, route-migration, dal-hardening]
dependency_graph:
  requires: [TenantContext, RequireRole, RequirePromotor, RequireOrgAdmin, tenant_context_required]
  provides: [tenant-scoped-route-handlers, org-scoped-conversation-mutations, real-org-id-in-spawn]
  affects:
    - server/src/jobs/routes.rs
    - server/src/jobs/rewrite.rs
    - server/src/connections/routes.rs
    - server/src/connections/db.rs
    - server/src/cloud/routes.rs
    - server/src/cloud/db.rs
    - server/src/ai/routes.rs
    - server/src/ai/db.rs
    - server/src/discovery/routes.rs
    - server/src/discovery/validation_routes.rs
    - server/src/routes/scripts.rs
    - server/src/tenant.rs
    - server/src/main.rs
tech_stack:
  added: []
  patterns:
    - RequireRole(ctx) extractor as first handler parameter
    - ctx.as_ctx() for list queries, ctx.scoped(x) for detail lookups
    - org_id propagated through internal DAL call chains (rewrite, build_storage_config, resolve_cloud_account_ids)
    - AND organization_id = ? guard on conversation mutations
key_files:
  created: []
  modified:
    - server/src/jobs/routes.rs
    - server/src/jobs/rewrite.rs
    - server/src/connections/routes.rs
    - server/src/connections/db.rs
    - server/src/cloud/routes.rs
    - server/src/cloud/db.rs
    - server/src/ai/routes.rs
    - server/src/ai/db.rs
    - server/src/discovery/routes.rs
    - server/src/discovery/validation_routes.rs
    - server/src/routes/scripts.rs
    - server/src/tenant.rs
    - server/src/main.rs
decisions:
  - "routes/scripts.rs validate_script migrated as deviation (not in plan files list) — it also called rewrite::resolve which now takes org_id"
  - "rewrite.rs resolve() takes org_id: &str as second parameter; callers (jobs/routes.rs, routes/scripts.rs) pass ctx.org_id.0 as &str"
  - "build_storage_config takes explicit org_id: &str parameter instead of relying on ctx; env_snapshot/env_snapshot_all derive org_id from ctx.org_id().as_str()"
  - "tenant.rs placeholder() renamed to startup_ctx() — sole permitted use is server startup catalog restore in main.rs; placeholder_ctx/placeholder_scoped/placeholder_with functions removed"
  - "ai/db.rs get_conversation added for org-scoped ownership check before returning messages"
metrics:
  duration: "~20 min"
  completed_date: "2026-02-26"
  tasks_completed: 2
  files_created: 0
  files_modified: 13
---

# Phase 4 Plan 02: Route Handler Migration & DAL Hardening Summary

**One-liner:** All route handlers migrated from placeholder_ctx/placeholder_scoped to RequireRole(ctx) extraction; conversation DAL hardened with org_id filters; org_id propagated through rewrite/storage/resolve call chains; placeholder functions removed from tenant.rs

## What Was Built

### Task 1: Route Handler Migration (6 files)

**server/src/jobs/routes.rs**
- All 10 handlers (list_jobs, create_job, get_job, update_job, cancel_job, delete_job, get_job_catalog, get_job_graph, get_unified_graph, get_dashboard_layout, save_dashboard_layout) now extract `RequireRole(ctx): RequireRole` as first parameter
- `placeholder_ctx()` → `ctx.as_ctx()`, `placeholder_scoped(x)` → `ctx.scoped(x)` everywhere
- `SpawnParams { org_id: SEED_ORG_ID.to_string() }` → `org_id: ctx.org_id.0.clone()` — real session org_id flows into job runner
- `rewrite::resolve()` call updated with `&ctx.org_id.0`

**server/src/connections/routes.rs**
- All 6 handlers migrated to `RequireRole(ctx)`
- `placeholder_ctx()` and `placeholder_scoped()` replaced throughout

**server/src/cloud/routes.rs**
- All 5 handlers migrated to `RequireRole(ctx)`

**server/src/discovery/routes.rs**
- `search_nodes`, `expand_node`, `query_discover`, `chart_discover`, `export_discover` → `RequireRole(_ctx)` (query in-memory graph, no per-org data)
- `load_discover` → `RequireRole(ctx)` with `ctx.scoped(id.as_str())` for job lookup and `ctx.as_ctx()` for env_snapshot_all

**server/src/discovery/validation_routes.rs**
- `validate_job` migrated to `RequireRole(ctx)` with `ctx.scoped()` and `ctx.as_ctx()`

**server/src/routes/scripts.rs** (deviation — extra file not listed in plan)
- `validate_script` migrated to `RequireRole(ctx)`; passes `&ctx.org_id.0` to `rewrite::resolve()`

### Task 2: AI Routes, DAL Hardening, Cleanup (7 files)

**server/src/ai/routes.rs**
- All 6 handlers migrated to `RequireRole(ctx)`
- `get_conversation_messages` now validates org ownership before returning messages (calls `get_conversation(id, org_id)` → 404 if not found)
- `rename_conversation` passes `ctx.org_id.as_str()` to DAL
- `delete_conversation` passes `ctx.org_id.as_str()` to DAL

**server/src/ai/db.rs** — tenant isolation security fix
- `rename_conversation(id, org_id, title)`: SQL now `UPDATE conversations SET title = ?1 WHERE id = ?2 AND organization_id = ?3`
- `delete_conversation(id, org_id)`: SQL now `DELETE FROM conversations WHERE id = ?1 AND organization_id = ?2`
- `get_conversation(id, org_id)`: new method for org-scoped ownership check

**server/src/connections/db.rs**
- `resolve_cloud_account_ids`: uses `TenantScoped::new(OrgId(ctx.org_id().as_str().to_string()), ...)` instead of `placeholder_with`
- `build_storage_config_from_connections`: calls `build_storage_config` with `ctx.org_id().as_str()` propagated
- `create_connection`: validates cloud account with `TenantScoped::new(ctx.org_id.clone(), ...)` instead of `placeholder_with`

**server/src/cloud/db.rs**
- `build_storage_config(ctx, org_id, account_ids)`: now takes explicit `org_id: &str`; uses `TenantScoped::new(OrgId(org_id.to_string()), ...)` for per-account scoping
- `env_snapshot` / `env_snapshot_all`: derive `org_id` from `ctx.org_id().as_str()`

**server/src/jobs/rewrite.rs**
- `resolve(script, org_id, db)`: takes `org_id: &str` as new second parameter
- Uses `TenantScoped::new(OrgId(org_id.to_string()), ...)` for connection and storage lookups

**server/src/tenant.rs** — cleanup
- Removed: `placeholder_ctx()`, `placeholder_scoped()`, `impl TenantScoped<T> { placeholder_with() }`, `impl TenantScoped<()> { placeholder() }`
- Kept: `impl TenantScoped<()> { startup_ctx() }` — only for server startup catalog restore in main.rs
- No `use crate::db::seed::SEED_ORG_ID` in tenant.rs (it's referenced inline only in startup_ctx)

**server/src/main.rs**
- `TenantScoped::placeholder()` → `TenantScoped::startup_ctx()` for catalog restore

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] routes/scripts.rs also called rewrite::resolve**
- **Found during:** Task 1 — cargo check after updating rewrite::resolve signature
- **Issue:** `routes/scripts.rs::validate_script` called `rewrite::resolve(&payload.script, &state.db)` with the old 2-arg signature; not listed in plan's file list
- **Fix:** Migrated `validate_script` to use `RequireRole(ctx)` and pass `&ctx.org_id.0` to `rewrite::resolve()`
- **Files modified:** server/src/routes/scripts.rs
- **Commit:** a0dd376

## Verification Results

- `cargo build`: PASSED
- `cargo clippy -- -D warnings`: PASSED (clean)
- `cargo test`: PASSED (2/2 auth_smoke tests)
- `grep placeholder_ctx|placeholder_scoped|placeholder_with`: zero results in server/src/
- `grep SEED_ORG_ID server/src/`: only tenant.rs (startup_ctx), db/seed.rs (seed data), jobs/runner.rs (comment) — no route handlers
- All conversation mutations (rename, delete) filter by AND organization_id = ?
- Every route handler in jobs, connections, cloud, ai, discovery, validation_routes, scripts has RequireRole(ctx)

## Self-Check: PASSED
