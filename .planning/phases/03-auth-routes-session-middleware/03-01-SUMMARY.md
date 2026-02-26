---
phase: 03-auth-routes-session-middleware
plan: 01
subsystem: auth
tags: [auth, session, argon2, sqlite, schema, cargo]
dependency_graph:
  requires: []
  provides: [auth-module, auth-error-types, password-utilities, invite-token-dal, user-session-dal, schema-tables]
  affects: [server/src/error.rs, server/src/config.rs, server/src/db/]
tech_stack:
  added: [tower-sessions 0.14, tower-sessions-rusqlite-store 0.14.1, time 0.3]
  patterns: [Argon2id-spawn-blocking, thiserror-IntoResponse, SQLite-invite-tokens]
key_files:
  created:
    - server/src/auth/mod.rs
    - server/src/auth/errors.rs
    - server/src/auth/models.rs
    - server/src/auth/password.rs
    - server/src/db/invite_tokens.rs
  modified:
    - server/Cargo.toml
    - server/src/db/schema.rs
    - server/src/db/mod.rs
    - server/src/db/seed.rs
    - server/src/error.rs
    - server/src/config.rs
    - server/src/main.rs
decisions:
  - "Upgraded rusqlite from 0.32 to 0.37 to resolve libsqlite3-sys links conflict with tower-sessions-rusqlite-store (which requires rusqlite 0.37)"
  - "Removed tokio-rusqlite from direct Cargo.toml deps — it is pulled in transitively by tower-sessions-rusqlite-store; no direct usage needed in Plan 01"
  - "All auth functions/types annotated with #[allow(dead_code)] — Plan 02 route handlers will be their first consumers"
metrics:
  duration: "~8 min"
  completed: "2026-02-26"
  tasks_completed: 3
  files_created: 5
  files_modified: 7
---

# Phase 03 Plan 01: Auth Module Foundation Summary

**One-liner:** Argon2id auth foundation with invite-token DAL, user_sessions schema, and tower-sessions Cargo wiring — ready for Plan 02 route handlers.

## What Was Built

Established all building blocks that Plan 02 (route handlers + session middleware) will consume:

1. **Cargo.toml** — Added `tower-sessions 0.14`, `tower-sessions-rusqlite-store 0.14.1`, `time 0.3`. Upgraded `rusqlite` from `0.32` to `0.37` to resolve a `libsqlite3-sys` links conflict.

2. **Schema** (`server/src/db/schema.rs`) — Two new tables:
   - `user_sessions` (user_id PK, session_id, created_at) — enforces single active session per user
   - `invite_tokens` (token PK, email, org_id, role, created_by, used_at, expires_at, created_at) — invite-only registration

3. **Auth module** (`server/src/auth/`):
   - `errors.rs` — `AuthError` thiserror enum (7 variants: InvalidCredentials, RegistrationFailed, SessionRequired, SessionExpired, RateLimited, Forbidden, Internal) all with `IntoResponse` producing machine-readable JSON codes (`auth/...` namespace)
   - `models.rs` — `RegisterRequest` and `LoginRequest` serde structs
   - `password.rs` — `hash_password` / `verify_password` (async via `spawn_blocking`), `dummy_hash` for timing-attack prevention, `validate_password` (12-128 chars, upper+lower+digit), `validate_email`

4. **Invite token DAL** (`server/src/db/invite_tokens.rs`) — `get_invite_token`, `mark_invite_token_used`, `create_invite_token`, `upsert_user_session` (returns old session_id for cleanup), `delete_user_session`, `get_user_session_id`

5. **AppError extension** (`server/src/error.rs`) — Added `Unauthorized` (401), `Forbidden` (403), and `Auth(#[from] AuthError)` bridging variants

6. **ServerConfig** (`server/src/config.rs`) — Added `session_secret: SecretString` field, required from `KEASY_SESSION_SECRET` env var; fatal exit if not set

7. **Seed data** (`server/src/db/seed.rs`) — Bootstrap invite token `SEED_INVITE_TOKEN = "00000000000000000000000000000001"`, org=SEED_ORG_ID, role=admin, expires 2099-12-31

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] rusqlite version conflict between project (0.32) and tower-sessions-rusqlite-store (0.37)**
- **Found during:** Task 1
- **Issue:** `tower-sessions-rusqlite-store 0.14.1` depends on `rusqlite = "0.37"` which pulls `libsqlite3-sys 0.35`. The project used `rusqlite = "0.32"` with `bundled` feature (pulling `libsqlite3-sys 0.30`). Both crates define `links = "sqlite3"` — Cargo rejects this as a conflict. The plan notes "Cargo resolves them independently" which is incorrect for the `links` mechanism.
- **Fix:** Upgraded project's `rusqlite` to `0.37` (same version as the store); removed explicit `tokio-rusqlite = "0.7"` from direct deps (it's a transitive dep of the store, no direct usage needed in Plan 01).
- **Files modified:** `server/Cargo.toml`
- **Commits:** dff23cb

**2. [Rule 2 - Missing] dead_code clippy warnings from auth types not yet used at call sites**
- **Found during:** Task 3
- **Issue:** `cargo clippy -- -D warnings` flagged `AuthError` variants, `RegisterRequest`, `LoginRequest`, `hash_password`, `verify_password`, `dummy_hash`, `validate_password`, `validate_email`, and `config.session_secret` as dead code since Plan 02 hasn't wired them yet.
- **Fix:** Added `#[allow(dead_code)]` to `AuthError`, model structs, password functions, and `session_secret` field — consistent with the existing `#[allow(dead_code)]` pattern on `AppError` from prior phases.
- **Files modified:** `server/src/auth/errors.rs`, `server/src/auth/models.rs`, `server/src/auth/password.rs`, `server/src/config.rs`
- **Commits:** 3a2b00b

**3. [Rule 1 - Bug] doc comment continuation lint in validate_password**
- **Found during:** Task 3
- **Issue:** `clippy::doc-lazy-continuation` flagged the "Returns Ok(()) if..." line as a continuation without blank line separator.
- **Fix:** Added blank line between the list and the Returns paragraph in the doc comment.
- **Files modified:** `server/src/auth/password.rs`
- **Commits:** 3a2b00b

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | dff23cb | feat(03-01): add session/auth Cargo deps and extend schema with invite_tokens and user_sessions |
| 2 | 77be54a | feat(03-01): create auth module with AuthError, models, password utils, and invite token DAL |
| 3 | 3a2b00b | feat(03-01): extend AppError with Unauthorized/Forbidden/Auth and add session_secret to ServerConfig |

## Self-Check: PASSED

- server/src/auth/mod.rs: FOUND
- server/src/auth/errors.rs: FOUND
- server/src/auth/models.rs: FOUND
- server/src/auth/password.rs: FOUND
- server/src/db/invite_tokens.rs: FOUND
- cargo clippy -- -D warnings: PASSED (no errors)
- Schema contains invite_tokens and user_sessions: VERIFIED
- AppError has Unauthorized, Forbidden, Auth variants: VERIFIED
- ServerConfig has session_secret field: VERIFIED
