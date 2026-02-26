---
phase: 02-api-architecture-refactor
plan: 02
subsystem: server/jobs, server/connections, server/cloud_accounts, server/conversations, server/graph, server/settings, server/validation
tags: [domain-organization, typed-errors, response-envelope, refactoring]
dependency_graph:
  requires: [02-01]
  provides: [domain-colocated-routes, JobApiError, ConnectionError, CloudAccountError, domain-db-impls, clean-router]
  affects: [server/src/routes/mod.rs, server/src/main.rs, server/src/error.rs]
tech_stack:
  added: []
  patterns: [domain-colocated-folders, thiserror-domain-errors, data_response-envelope, 204-delete-pattern]
key_files:
  created:
    - server/src/jobs/mod.rs
    - server/src/jobs/models.rs
    - server/src/jobs/errors.rs
    - server/src/jobs/db.rs
    - server/src/jobs/routes.rs
    - server/src/jobs/runner.rs
    - server/src/connections/mod.rs
    - server/src/connections/models.rs
    - server/src/connections/errors.rs
    - server/src/connections/db.rs
    - server/src/connections/routes.rs
    - server/src/cloud_accounts/mod.rs
    - server/src/cloud_accounts/models.rs
    - server/src/cloud_accounts/errors.rs
    - server/src/cloud_accounts/db.rs
    - server/src/cloud_accounts/routes.rs
    - server/src/conversations/mod.rs
    - server/src/conversations/models.rs
    - server/src/conversations/db.rs
    - server/src/conversations/routes.rs
    - server/src/graph/routes.rs
    - server/src/settings/db.rs
    - server/src/settings/routes.rs
    - server/src/validation/routes.rs
  modified:
    - server/src/error.rs
    - server/src/main.rs
    - server/src/db/mod.rs
    - server/src/settings/mod.rs
    - server/src/graph/mod.rs
    - server/src/validation/mod.rs
    - server/src/routes/mod.rs
    - server/src/script/rewrite.rs
    - server/src/middleware/auth.rs
decisions:
  - "Old job/ directory replaced by jobs/ — JobError struct renamed to JobRuntimeError to avoid collision with new JobApiError thiserror enum"
  - "ConnectionError, CloudAccountError, JobApiError each have their own IntoResponse and to_http() — no generic AppError wrapping needed in route handlers"
  - "Route audit confirmed: GET /v1/graph (unified graph) kept as used by frontend fetchUnifiedGraph; get_connection_by_name kept as used by script/rewrite.rs"
  - "AppError gets #[error(transparent)] bridging variants for domain errors for future cross-domain use"
  - "db/settings.rs moved to settings/db.rs; settings/types.rs split between connections/models.rs and cloud_accounts/models.rs"
metrics:
  duration: 10 min
  completed: "2026-02-26"
  tasks_completed: 2
  files_changed: 24
---

# Phase 02 Plan 02: API Domain Reorganization & Error Handling Summary

**One-liner:** Reorganized flat module structure into domain-colocated folders (jobs, connections, cloud_accounts, conversations, graph, settings, validation) with typed thiserror enums per domain, data_response() envelope on all handlers, and 204 DELETE responses.

## What Was Built

### Task 1: Create domain folders for jobs, connections, cloud_accounts, conversations (commit 79506e1)

Created four new domain folders, each containing mod.rs, models.rs (or appropriate), errors.rs, db.rs, and routes.rs:

**Jobs domain (`src/jobs/`):**
- `models.rs` — content from `src/job/types.rs`, `ErrorEnvelope`/`ErrorDetail` removed
- `errors.rs` — `JobRuntimeError` (renamed from old `JobError`; stored in DB) + new `JobApiError` thiserror enum with `to_http()` and `IntoResponse`
- `db.rs` — Database impl methods from `src/db/jobs.rs`
- `routes.rs` — all job handlers using typed `JobApiError` return, `data_response()` envelope, `Ok(StatusCode::NO_CONTENT)` for DELETE
- `runner.rs` — from `src/job/runner.rs`, updated to use `JobRuntimeError`

**Connections domain (`src/connections/`):**
- `models.rs` — `Connection`, `ConnectionKind`, `LocationType`, etc. extracted from `src/settings/types.rs`
- `errors.rs` — `ConnectionError` thiserror enum
- `db.rs` — from `src/db/connections.rs`
- `routes.rs` — typed `ConnectionError` return, `data_response()` envelope

**Cloud Accounts domain (`src/cloud_accounts/`):**
- `models.rs` — `CloudAccount`, `CloudAccountSummary`, etc. extracted from `src/settings/types.rs`
- `errors.rs` — `CloudAccountError` thiserror enum
- `db.rs` — from `src/db/cloud_accounts.rs`
- `routes.rs` — typed `CloudAccountError` return, `data_response()` envelope

**Conversations domain (`src/conversations/`):**
- `models.rs` — `Conversation` and `ConversationMessage` structs (previously defined inline in db file)
- `db.rs` — from `src/db/conversations.rs`
- `routes.rs` — updated to use `data_response()` envelope, error codes normalized to snake_case

Updated `src/error.rs` with `#[error(transparent)]` bridging variants for `JobApiError`, `ConnectionError`, `CloudAccountError`. Updated `src/main.rs` with new module declarations. Updated `src/db/mod.rs`, `src/settings/mod.rs`. Deleted old `src/job/`, `src/db/jobs.rs`, `src/db/connections.rs`, `src/db/cloud_accounts.rs`, `src/db/conversations.rs`, `src/db/settings.rs`, `src/settings/types.rs`, and old route files.

### Task 2: Move remaining domain routes, wire router, final cleanup (commit 52bf716)

**Graph domain (`src/graph/routes.rs`):**
- Moved from `src/routes/graph.rs`
- Uses `data_response()` envelope, `error_body()` directly for error responses
- Error codes normalized to snake_case

**Settings domain (`src/settings/db.rs` + `routes.rs`):**
- `db.rs` — moved from `src/db/settings.rs`
- `routes.rs` — moved from `src/routes/settings.rs`, uses `data_response()` envelope

**Validation domain (`src/validation/routes.rs`):**
- Moved from `src/routes/validation.rs`
- Uses `error_body()` directly, error codes normalized to snake_case
- Now imports `ConnectionError` from `crate::connections::models`

**Router update (`src/routes/mod.rs`):**
- Removed all domain module declarations (cloud_accounts, conversations, graph, jobs, connections, settings, validation)
- Removed `error_response()` function entirely
- Removed `ErrorDetail`/`ErrorEnvelope` imports
- `build_router()` now references all handlers via `crate::domain::routes::handler` paths
- Kept `health`, `providers`, `scripts` in `routes/` (cross-cutting, no domain folder)

**Middleware fix (`src/middleware/auth.rs`):**
- Updated to use `error_body()` + `IntoResponse` directly instead of removed `error_response()`

## Verification Results

| Check | Result |
|-------|--------|
| `cargo check` | 0 errors, 1 dead_code warning (AppError variants — expected) |
| `cargo build` | Finished cleanly |
| `cargo clippy` | 0 actionable warnings |
| Domain folders: jobs, connections, cloud_accounts, conversations | All present with correct files |
| `grep error_response routes/` | Zero matches |
| `grep ErrorEnvelope\|ErrorDetail src/` | Zero matches |
| `grep fn placeholder_ctx routes/` | Zero matches |
| `grep data_response jobs/routes.rs` | Present |
| Old `src/job/` directory | Deleted |
| Old `src/db/jobs.rs` etc. | All deleted |
| Old route files | All deleted |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Middleware auth.rs used removed error_response()**
- **Found during:** Task 2 wiring
- **Issue:** `src/middleware/auth.rs` imported `crate::routes::error_response` which was removed
- **Fix:** Updated to use `axum::Json` + `crate::error::error_body` + `.into_response()` directly
- **Files modified:** `server/src/middleware/auth.rs`
- **Commit:** 79506e1

**2. [Rule 3 - Blocking] Duplicate Json import in middleware/auth.rs**
- **Found during:** Task 2 cargo check
- **Issue:** Added `use axum::Json;` but it was already in the use block
- **Fix:** Removed duplicate import
- **Files modified:** `server/src/middleware/auth.rs`
- **Commit:** 79506e1 (same)

**3. [Rule 2 - Missing] conversations/routes.rs imports old db::conversations types**
- **Found during:** Task 1 cargo check
- **Issue:** Old route file imported `crate::db::conversations::{Conversation, ConversationMessage}` which no longer existed
- **Fix:** Route was fully rewritten to use `crate::conversations::models::*`
- **Files modified:** `server/src/conversations/routes.rs`
- **Commit:** 79506e1

## Self-Check: PASSED

| Item | Status |
|------|--------|
| server/src/jobs/mod.rs | FOUND |
| server/src/connections/mod.rs | FOUND |
| server/src/cloud_accounts/mod.rs | FOUND |
| server/src/conversations/mod.rs | FOUND |
| server/src/graph/routes.rs | FOUND |
| server/src/settings/db.rs | FOUND |
| server/src/settings/routes.rs | FOUND |
| server/src/validation/routes.rs | FOUND |
| commit 79506e1 (feat: create domain folders) | FOUND |
| commit 52bf716 (feat: move remaining routes, wire router) | FOUND |
