---
phase: 03-auth-routes-session-middleware
plan: 02
subsystem: auth
tags: [auth, session, rate-limit, middleware, axum, tower-sessions, sqlite]
dependency_graph:
  requires: [03-01]
  provides: [auth-routes, session-middleware, rate-limiter, router-session-wiring]
  affects: [server/src/auth/, server/src/middleware/, server/src/routes/mod.rs, server/src/main.rs, server/src/db/users.rs]
tech_stack:
  added: [tower-sessions signed feature, PBKDF2 key derivation for cookie signing]
  patterns: [session-fixation-prevention-cycle_id, single-session-enforcement-via-user_sessions, timing-attack-safe-dummy-hash, per-IP-sliding-window-rate-limit]
key_files:
  created:
    - server/src/auth/rate_limit.rs
    - server/src/auth/routes.rs
    - server/src/middleware/session_auth.rs
  modified:
    - server/src/auth/mod.rs
    - server/src/middleware/mod.rs
    - server/src/db/users.rs
    - server/src/routes/mod.rs
    - server/src/main.rs
    - server/Cargo.toml
decisions:
  - "tower-sessions signed feature added to Cargo.toml — cookie signing uses PBKDF2-SHA256 key derivation from KEASY_SESSION_SECRET to always produce the required 64 bytes"
  - "tokio_rusqlite accessed via tower_sessions_rusqlite_store::tokio_rusqlite re-export — no direct dep needed since Plan 01 removed it from Cargo.toml"
  - "api_key_auth kept in middleware/auth.rs with #[allow(dead_code)] — reserved for future machine-to-machine API access; not applied to any routes"
  - "Session cookie: httpOnly, SameSite=Lax, signed, name=keasy.sid, with_secure=false (configurable TODO for prod)"
metrics:
  duration: "~7 min"
  completed: "2026-02-26"
  tasks_completed: 3
  files_created: 3
  files_modified: 6
---

# Phase 03 Plan 02: Auth Routes, Session Middleware, and Router Wiring Summary

**One-liner:** Invite-only register/login/logout handlers with Argon2id, session-fixation prevention, single-session enforcement, per-IP rate limiting, and signed session cookies replacing api_key_auth.

## What Was Built

Connected all auth building blocks from Plan 01 into a working authentication system:

1. **Rate limiter** (`server/src/auth/rate_limit.rs`) — `RateLimiter` struct using `Arc<std::sync::Mutex<HashMap<IpAddr, VecDeque<Instant>>>>`. Sliding window: 5 attempts per 60 seconds per IP. `check(ip)` prunes expired entries on every call.

2. **Session auth middleware** (`server/src/middleware/session_auth.rs`) — `session_required` middleware reads `user_id` from the Session, then cross-checks the current session_id against the `user_sessions` table. If the session_id doesn't match the stored active session (i.e., the user has logged in from a new location), the stale session is flushed and a 401 is returned. `AuthenticatedUser { user_id }` is stored in request extensions for downstream handlers.

3. **Route handlers** (`server/src/auth/routes.rs`):
   - `register`: Rate check → validate invite token (exists, unused, not expired) → email/password validation → Argon2id hash → create user (first_name/last_name empty per CONTEXT.md) → create org membership → mark token used → `cycle_id()` (session fixation prevention) → insert user_id → 24h expiry → upsert user_sessions → 201
   - `login`: Rate check → lookup by email → ALWAYS verify password (dummy_hash if user not found, timing-attack safe) → check Active status → `cycle_id()` → insert user_id → 24h expiry → upsert user_sessions (single session enforcement) → 200
   - `logout`: Get user_id from session → delete user_sessions entry → `flush()` session → 204

4. **User org membership DAL** (`server/src/db/users.rs`) — `Database::create_user_org_membership()` inserts a row into `user_org_memberships` table.

5. **Router wiring** (`server/src/routes/mod.rs`) — `build_router` now accepts `session_store` and `session_secret`. Creates `SessionManagerLayer` with signed cookies (PBKDF2-derived 64-byte key), name `keasy.sid`, httpOnly, SameSite=Lax. Public routes: `/healthz/*`, `/v1/settings/schema`, `/v1/providers`, `/v1/auth/register`, `/v1/auth/login`. Protected: `/v1/auth/logout` + all existing api_routes, both using `session_required`.

6. **AppState and main.rs** — `AppState` gains `rate_limiter: RateLimiter`. `main()` opens a separate `tokio_rusqlite` connection for the session store, migrates it, spawns background expired-session deletion task (every 60s), passes session store and secret to `build_router`, and uses `into_make_service_with_connect_info::<SocketAddr>()` for `ConnectInfo<SocketAddr>` in handlers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] tower-sessions `signed` feature not in Cargo.toml**
- **Found during:** Task 3
- **Issue:** `with_signed()` method not available; `SessionManagerLayer` does not have this method without enabling the `signed` feature in `tower-sessions`.
- **Fix:** Changed `tower-sessions = "0.14"` to `tower-sessions = { version = "0.14", features = ["signed"] }` in Cargo.toml.
- **Files modified:** `server/Cargo.toml`
- **Commit:** 505ad90

**2. [Rule 3 - Blocking] `tokio_rusqlite` not directly available as a crate**
- **Found during:** Task 3
- **Issue:** Plan 01 removed `tokio_rusqlite` from direct deps (it's a transitive dep). Using `tokio_rusqlite::Connection::open()` directly fails.
- **Fix:** Used `tower_sessions_rusqlite_store::tokio_rusqlite::Connection::open()` — the store re-exports `tokio_rusqlite` as `pub use tokio_rusqlite`.
- **Files modified:** `server/src/main.rs`
- **Commit:** 505ad90

**3. [Rule 2 - Missing] `ExpiredDeletion` trait not in scope for `continuously_delete_expired`**
- **Found during:** Task 3
- **Issue:** `continuously_delete_expired` is a trait method from `tower_sessions_core::ExpiredDeletion`; must be imported.
- **Fix:** Added `use tower_sessions::ExpiredDeletion;` to main.rs.
- **Files modified:** `server/src/main.rs`
- **Commit:** 505ad90

**4. [Rule 2 - Missing] PBKDF2 key derivation needed for `Key::from` which requires 64 bytes**
- **Found during:** Task 3
- **Issue:** `Key::from` requires exactly 64 bytes but `KEASY_SESSION_SECRET` may be any length. The plan mentioned padding or using `Key::try_from` but didn't specify the exact mechanism.
- **Fix:** Added `derive_session_key()` helper using `pbkdf2::hmac::Hmac<Sha256>` with a fixed salt to deterministically produce 64 bytes from any-length secret. `pbkdf2` and `sha2` were already in Cargo.toml.
- **Files modified:** `server/src/routes/mod.rs`
- **Commit:** 505ad90

**5. [Rule 1 - Bug] Clippy `-D warnings` failures: dead_code and missing Default impl**
- **Found during:** Task 3 verification
- **Issue:** Five clippy errors: `api_key_auth`/`constant_time_eq`/`extract_key` dead code in middleware/auth.rs; `AuthenticatedUser.user_id` dead code; `RateLimiter::new_without_default` lint.
- **Fix:** Added `#[allow(dead_code)]` to the three functions in middleware/auth.rs and to `user_id` field; implemented `Default for RateLimiter` delegating to `RateLimiter::new()`.
- **Files modified:** `server/src/middleware/auth.rs`, `server/src/middleware/session_auth.rs`, `server/src/auth/rate_limit.rs`
- **Commit:** 505ad90

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 7fb354c | feat(03-02): add rate limiter, session auth middleware, and user_org_membership DAL |
| 2 | 1664aad | feat(03-02): create register, login, logout route handlers |
| 3 | 505ad90 | feat(03-02): wire session layer, auth routes, and session middleware into router |

## Self-Check: PASSED

- server/src/auth/rate_limit.rs: FOUND
- server/src/auth/routes.rs: FOUND
- server/src/middleware/session_auth.rs: FOUND
- Commit 7fb354c: FOUND
- Commit 1664aad: FOUND
- Commit 505ad90: FOUND
- cargo clippy -- -D warnings: PASSED (no warnings)
