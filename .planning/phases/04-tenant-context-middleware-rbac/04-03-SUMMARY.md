---
phase: 04-tenant-context-middleware-rbac
plan: "03"
subsystem: server/routes,server/tests
tags: [rbac, tenant-isolation, integration-tests, admin-endpoints, promotor]
dependency_graph:
  requires: [TenantContext, RequireRole, RequirePromotor, tenant_context_required, set-active-dataspace]
  provides: [promotor-admin-endpoints, tenant-isolation-tests, rbac-integration-tests]
  affects:
    - server/src/routes/mod.rs
    - server/src/routes/admin.rs
    - server/src/db/dataspaces.rs
    - server/src/db/organizations.rs
    - server/src/auth/routes.rs
    - server/tests/tenant_isolation.rs
tech_stack:
  added: []
  patterns:
    - RequirePromotor extractor on all admin handlers
    - tower::ServiceExt::oneshot with MockConnectInfo for in-process integration tests
    - session.save() before session.id() to ensure tower-sessions assigns ID after cycle_id
key_files:
  created:
    - server/src/routes/admin.rs
    - server/tests/tenant_isolation.rs
  modified:
    - server/src/routes/mod.rs
    - server/src/db/dataspaces.rs
    - server/src/db/organizations.rs
    - server/src/auth/routes.rs
decisions:
  - "session.save() must be called before session.id() after cycle_id() — tower-sessions sets id to None after cycle_id; save() triggers store.create() which assigns the real ID"
  - "Password for test users must satisfy validate_password (12+ chars, upper, lower, digit) — use TestPassword123 pattern in tests"
  - "MockConnectInfo(SocketAddr) layer added to test router so ConnectInfo<SocketAddr> extraction works in oneshot tests"
metrics:
  duration: "~25 min"
  completed_date: "2026-02-26"
  tasks_completed: 2
  files_created: 2
  files_modified: 4
---

# Phase 4 Plan 03: Admin Endpoints and Tenant Isolation Tests Summary

**One-liner:** Five promotor-only admin endpoints under /v1/admin/, comprehensive integration tests (9 tests) verifying cross-org isolation, RBAC enforcement, and no-active-dataspace errors; fixed session.id() after cycle_id() bug in auth routes

## What Was Built

### routes/admin.rs (new)

Five promotor-only handlers using `RequirePromotor` extractor:
- `list_all_orgs`: `GET /v1/admin/organizations` → all organizations (promotors only)
- `list_all_dataspaces`: `GET /v1/admin/dataspaces` → all dataspaces
- `create_dataspace`: `POST /v1/admin/dataspaces` → create new dataspace (returns 201)
- `add_org_to_dataspace`: `POST /v1/admin/organizations/{org_id}/dataspaces` → add membership
- `remove_org_from_dataspace`: `DELETE /v1/admin/organizations/{org_id}/dataspaces/{ds_id}` → remove membership (204)

Non-promotor users receive 403 `rbac/insufficient_role` from the extractor before the handler runs.

### db/dataspaces.rs (extended)

- Added `remove_org_from_dataspace(org_id, dataspace_id)`: `DELETE FROM org_dataspace_memberships WHERE org_id = ? AND dataspace_id = ?`

### db/organizations.rs + db/dataspaces.rs (extended)

- Added `#[derive(serde::Serialize)]` to `Organization` and `Dataspace` structs — required for `data_response()` serialization in admin handlers

### routes/mod.rs (extended)

- Added `pub mod admin;` module declaration
- Added four admin route groups to `api_routes` (protected by both `session_required` and `tenant_context_required`)

### tests/tenant_isolation.rs (new, 9 tests)

| Test | What it verifies |
|------|-----------------|
| `test_no_active_dataspace_returns_403` | 403 + `rbac/no_active_dataspace` before set-dataspace |
| `test_set_dataspace_then_access_works` | 204 on set-dataspace, then 200 on /v1/jobs |
| `test_set_invalid_dataspace_returns_403` | 403 when org not member of dataspace |
| `test_cross_org_job_returns_404` | 404 (not 403) for cross-org job detail access |
| `test_cross_org_list_scoped` | Only own org's jobs returned in list |
| `test_promotor_admin_endpoints` | 200 for promotor on /v1/admin/* |
| `test_non_promotor_admin_endpoints_403` | 403 + `rbac/insufficient_role` for participant |
| `test_auth_me_returns_user_info` | /v1/auth/me returns user info; active_dataspace_id null then populated |
| `test_seed_constants_are_present` | Compile-time check that seed constants are exported |

Test infrastructure uses `axum::extract::connect_info::MockConnectInfo` layer and `tower::ServiceExt::oneshot`.

### auth/routes.rs (bug fix — Rule 1)

Fixed `session.id()` returning `None` after `cycle_id()` in both `register` and `login` handlers. Added `session.save()` call between `set_expiry()` and `session.id()` so tower-sessions can assign a real session ID via `store.create()` before we read it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] session.id() always None after cycle_id()**
- **Found during:** Task 2 — login returned 500 "session has no ID after cycle_id" in all tests
- **Issue:** `tower_sessions::Session::cycle_id()` sets the internal `session_id` lock to `None` (so `save()` will call `store.create()` instead of `store.save()`). Calling `session.id()` immediately after `cycle_id()` returns `None`. The production register and login handlers both had this bug — they called `session.id()` before the session was ever saved to the store.
- **Fix:** Added `session.save()` after `set_expiry()` in both `register` and `login` handlers. After `save()`, `store.create()` assigns a real ID and sets `session_id` in the lock, so `session.id()` returns `Some(id)`.
- **Files modified:** server/src/auth/routes.rs
- **Commit:** 0218f00

**2. [Rule 2 - Missing] Password validation in test**
- **Found during:** Task 2 — Org B registration returned 400
- **Issue:** Test used "test1234" (8 chars, no uppercase) which fails `validate_password()` (requires 12+ chars, uppercase, lowercase, digit)
- **Fix:** Changed test password to "TestPassword123"
- **Files modified:** server/tests/tenant_isolation.rs
- **Commit:** 0218f00

**3. [Rule 1 - Bug] invite_tokens FK constraint in test**
- **Found during:** Task 2 — `test_non_promotor_admin_endpoints_403` panicked on direct DB insert
- **Issue:** Test used `created_by = "system"` for invite token, but `invite_tokens.created_by` has a FK to `users(id)`
- **Fix:** Changed to use `SEED_ADMIN_ID` as `created_by`
- **Files modified:** server/tests/tenant_isolation.rs
- **Commit:** 0218f00

## Verification Results

- `cargo check`: PASSED
- `cargo clippy -- -D warnings`: PASSED (clean — fixed 3 redundant closure warnings in admin.rs)
- `cargo test --test auth_smoke`: PASSED (2/2 tests)
- `cargo test --test tenant_isolation`: PASSED (9/9 tests)
- `cargo test`: PASSED (11 tests total)
- Cross-org job access returns 404, not 403 (verified by test_cross_org_job_returns_404)
- No active dataspace → 403 (verified by test_no_active_dataspace_returns_403)
- Insufficient role → 403 `rbac/insufficient_role` (verified by test_non_promotor_admin_endpoints_403)
- Promotor endpoints → 200 (verified by test_promotor_admin_endpoints)

## Self-Check: PASSED
