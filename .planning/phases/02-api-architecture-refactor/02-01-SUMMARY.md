---
phase: 02-api-architecture-refactor
plan: 01
subsystem: server/error, server/job/runner, web/api
tags: [error-handling, response-envelope, spawn-params, frontend-fetcher]
dependency_graph:
  requires: []
  provides: [AppError, data_response, error_body, placeholder_ctx, placeholder_scoped, SpawnParams, envelope-aware-request]
  affects: [server/src/routes/*, web/src/lib/api.ts]
tech_stack:
  added: [thiserror = "2"]
  patterns: [IntoResponse for typed errors, flat JSON error envelope, data envelope, SpawnParams struct]
key_files:
  created:
    - server/src/error.rs
  modified:
    - server/Cargo.toml
    - server/src/main.rs
    - server/src/tenant.rs
    - server/src/job/runner.rs
    - server/src/routes/jobs.rs
    - web/src/lib/api.ts
decisions:
  - "AppError uses thiserror 2 with IntoResponse; flat JSON format { error: code, message } is locked"
  - "data_response() helper wraps all successful payloads in { data: ... } envelope"
  - "placeholder_ctx/placeholder_scoped centralized in tenant.rs; per-route definitions unchanged until Plan 02"
  - "SpawnParams struct replaces 7-arg JobRunner::spawn() to eliminate clippy::too_many_arguments"
  - "Frontend request() backward-compatible: unwraps .data when present, falls through otherwise"
metrics:
  duration: 3 min
  completed: "2026-02-26"
  tasks_completed: 3
  files_changed: 7
---

# Phase 02 Plan 01: API Error Foundation & Cross-Cutting Infrastructure Summary

**One-liner:** Typed AppError enum with thiserror + IntoResponse, flat JSON error/data envelope helpers, centralized placeholder context functions, SpawnParams struct, and backward-compatible frontend envelope unwrapping.

## What Was Built

### Task 1: Error handling foundation and placeholder helper centralization (commit 5244894)

Created `server/src/error.rs` with:
- `error_body(code, message)` — builds `{ "error": "snake_case", "message": "..." }` flat JSON (locked format)
- `validation_error_body(message, fields)` — adds `"fields": { "field": "reason" }` for validation errors
- `data_response<T: Serialize>(value: T)` — wraps successful payloads in `{ "data": ... }` envelope
- `AppError` enum (`NotFound`, `BadRequest`, `ValidationFailed`, `CloudError`, `Internal`) with `#[derive(thiserror::Error)]`
- `impl IntoResponse for AppError` mapping variants to correct HTTP status + error body

Added `thiserror = "2"` to `server/Cargo.toml` and declared `mod error;` in `main.rs`.

Added module-level `placeholder_ctx()` and `placeholder_scoped<T>()` functions to `tenant.rs` — centralized for Plan 02 route migration, with existing per-route definitions left intact.

### Task 2: SpawnParams struct (commit 82c9c8b)

Added `SpawnParams` struct to `server/src/job/runner.rs` above `impl JobRunner`.
Updated `JobRunner::spawn()` to accept `SpawnParams` instead of 7 positional arguments (destructured at top of method body).
Updated the call site in `routes/jobs.rs` to construct `SpawnParams { ... }`.
Result: `cargo clippy` reports 0 `too_many_arguments` warnings.

### Task 3: Frontend envelope-aware fetcher (commit e24c266)

Updated `web/src/lib/api.ts`:
- `throwResponseError()` now handles both new flat `{ "error": "code", "message": "msg" }` and old nested `{ "error": { "code": "...", "message": "..." } }` formats during transition period
- `request<T>()` transparently unwraps `{ "data": ... }` envelope when present; falls through for un-enveloped responses
- All exported API function signatures unchanged

## Verification Results

| Check | Result |
|-------|--------|
| `cargo check` | Finished (6 expected unused-fn warnings only) |
| `cargo clippy` — too_many_arguments | 0 |
| `thiserror` in Cargo.toml | Present |
| `pub fn placeholder_ctx` in tenant.rs | Present |
| `data_response` in error.rs | Present |
| `SpawnParams` in job/runner.rs | Present |
| `json?.data` in web/lib/api.ts | Present |
| `npx tsc --noEmit` | 0 errors |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| server/src/error.rs | FOUND |
| server/src/tenant.rs | FOUND |
| web/src/lib/api.ts | FOUND |
| commit 5244894 (feat: AppError + helpers) | FOUND |
| commit 82c9c8b (refactor: SpawnParams) | FOUND |
| commit e24c266 (feat: frontend envelope) | FOUND |
