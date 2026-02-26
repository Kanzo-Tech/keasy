---
phase: 03-auth-routes-session-middleware
plan: 03
subsystem: auth
tags: [auth, integration-test, security, session, clippy, rust]
dependency_graph:
  requires: [03-01, 03-02]
  provides: [security-smoke-test, lib-crate-re-exports]
  affects: [server/src/lib.rs, server/src/main.rs, server/Cargo.toml, server/tests/auth_smoke.rs]
tech_stack:
  added: [tower (dev, util feature), http-body-util (dev), tempfile (dev)]
  patterns: [tower-oneshot-integration-testing, lib-crate-for-integration-tests]
key_files:
  created:
    - server/src/lib.rs
    - server/tests/auth_smoke.rs
  modified:
    - server/src/main.rs
    - server/Cargo.toml
    - server/src/db/dataspaces.rs
decisions:
  - "lib.rs uses pub mod for all modules so integration tests can access types; main.rs imports from keasy_server:: crate"
  - "Integration test uses tower::ServiceExt::oneshot — no HTTP listener needed, fully in-process"
  - "tempfile::tempdir() leaked (std::mem::forget) so DB path remains valid for router lifetime in test"
  - "clippy::should_implement_trait suppressed on dataspaces.rs from_str methods — making modules pub exposed pre-existing lint hidden behind private mod in main.rs"
metrics:
  duration: "~3 min"
  completed: "2026-02-26"
  tasks_completed: 2
  files_created: 2
  files_modified: 3
---

# Phase 03 Plan 03: Security Smoke Test Summary

**One-liner:** Integration test asserting 401 on all 44 protected routes and non-401 on all 6 public routes, using tower::oneshot with temp SQLite — satisfies ROADMAP Phase 03 Success Criterion #4.

## What Was Built

Closed the single verification gap from Phase 03: the missing security smoke test.

1. **Library crate** (`server/src/lib.rs`) — Thin re-export layer converting the binary crate into a dual binary+library crate. Declares all 13 modules (`pub mod` for all), re-exports `AppState`, `OutputCache`, `Database`, `JobRunner`, `RdfGraph`, `RateLimiter`. `main.rs` now uses `use keasy_server::*` style imports with no duplicate type definitions.

2. **Dev-dependencies** (`server/Cargo.toml`) — Added `tower = { version = "0.5", features = ["util"] }`, `http-body-util = "0.1"`, `tempfile = "3"` to `[dev-dependencies]`.

3. **Security smoke test** (`server/tests/auth_smoke.rs`) — Two integration tests:
   - `protected_routes_return_401_without_session` — Asserts `StatusCode::UNAUTHORIZED` for all 44 protected method+path combinations (api_routes + logout_route). Uses a dummy UUID for path params; session middleware rejects before handlers execute.
   - `public_routes_do_not_return_401` — Asserts non-401 for all 6 public routes (healthz/live, healthz/ready, settings/schema, providers, auth/register, auth/login).
   - Both tests share `test_router()` helper that opens a temp SQLite DB, creates and migrates the session store, constructs a minimal `AppState`, and calls `build_router`. Uses `tower::ServiceExt::oneshot` — no network port needed.
   - MAINTAINER NOTE in test source: "When adding a new route to api_routes in routes/mod.rs, add a corresponding entry here."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] clippy::should_implement_trait errors in db/dataspaces.rs exposed by pub mod**
- **Found during:** Task 1 verification (`cargo clippy -- -D warnings`)
- **Issue:** Making all modules `pub mod` in `lib.rs` (instead of private `mod` in `main.rs`) caused clippy to check `DataspaceRole::from_str` and `OrgRole::from_str` as part of the public library surface. These methods had a naming collision with `std::str::FromStr::from_str`. The error was pre-existing but hidden behind the private module boundary.
- **Fix:** Added `#[allow(clippy::should_implement_trait)]` to both `from_str` methods in `server/src/db/dataspaces.rs`.
- **Files modified:** `server/src/db/dataspaces.rs`
- **Commit:** 69a9a3c

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 11cbca7 | feat(03-03): create lib.rs re-exports and add tower/tempfile dev-dependencies |
| 2 | 69a9a3c | feat(03-03): add auth_smoke integration test covering all 43 protected routes |

## Self-Check: PASSED

- server/src/lib.rs: FOUND
- server/tests/auth_smoke.rs: FOUND
- Commit 11cbca7: FOUND
- Commit 69a9a3c: FOUND
- cargo test --test auth_smoke: 2 passed, 0 failed
- cargo clippy -- -D warnings: PASSED (clean)
- cargo build: PASSED
- Protected routes covered: 44 method+path combinations
- Public routes covered: 6 method+path combinations
