---
phase: 12-walt-id-service-reduction-external-wallet-ui
plan: "01"
subsystem: auth
tags: [wallet, vc, docker, db-migration, backend-api]
dependency_graph:
  requires: []
  provides: [wallet-connection-api, user-wallet-fields, docker-cleanup]
  affects: [server/src/auth, server/src/db/users.rs, docker-compose.yml]
tech_stack:
  added: []
  patterns: [session-protected-routes, db-migration-pattern]
key_files:
  created:
    - server/src/auth/wallet_routes.rs
  modified:
    - docker-compose.yml
    - server/src/db/schema.rs
    - server/src/db/users.rs
    - server/src/auth/mod.rs
    - server/src/auth/routes.rs
    - server/src/routes/mod.rs
decisions:
  - "wallet_routes.rs placed in session_auth_routes (not api_routes) — needs session auth but NOT tenant context, parallel to /auth/me"
  - "unlink_did_from_user returns Result<(), String> for consistency with other DB methods; link_did_to_user retains Result<(), rusqlite::Error>"
metrics:
  duration: "2 min"
  completed_date: "2026-02-27"
  tasks_completed: 2
  files_changed: 7
---

# Phase 12 Plan 01: Walt.ID Service Reduction — Backend Wallet API Summary

Removed 4 hosted walt.id services from Docker Compose, added wallet_connected_at DB migration, created 3 wallet connection endpoints, and extended /auth/me with wallet status fields.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove hosted walt.id services from Docker Compose and add DB migration | f2b2a4d | docker-compose.yml, server/src/db/schema.rs |
| 2 | Extend User struct, add DB methods, create wallet endpoints, wire routes, extend get_me | 0a7144c | server/src/db/users.rs, server/src/auth/wallet_routes.rs, server/src/auth/mod.rs, server/src/auth/routes.rs, server/src/routes/mod.rs, server/src/routes/org.rs |

## What Was Built

### Docker Compose Cleanup
Removed `waltid-wallet-api`, `waltid-issuer-api`, `waltid-web-wallet`, and `waltid-web-portal` service blocks entirely. Removed orphaned volumes `waltid-wallet-data` and `waltid-issuer-data`. `waltid-verifier-api` remains under the `[walt-id]` profile, unchanged.

### DB Migration
Added `ALTER TABLE users ADD COLUMN wallet_connected_at TEXT` migration to `schema.rs`, following the existing `subject` column pattern with `let _ =` to safely ignore already-exists errors.

### User Struct Extension
Added `vc_holder_did: Option<String>` and `wallet_connected_at: Option<String>` fields to the `User` struct. Updated `row_to_user` to read 10 columns. Updated all four SELECT queries (`get_user`, `get_user_by_email`, `get_user_by_did`, `get_user_by_subject`) to fetch both new fields.

### New DB Methods
- `update_wallet_connected_at(user_id)` — sets `wallet_connected_at` and `updated_at` to current timestamp
- `unlink_did_from_user(user_id)` — NULLs both `vc_holder_did` and `wallet_connected_at`, updates `updated_at`

### Wallet Connection Endpoints
Created `server/src/auth/wallet_routes.rs` with three session-protected handlers:
- `GET /v1/auth/wallet` — returns `{ connected, did, connected_at }` for the current user
- `POST /v1/auth/vc-connect` — re-polls Verifier for defense-in-depth, saves DID and timestamp
- `DELETE /v1/auth/wallet` — NULLs wallet fields, returns `{ connected: false }`

### /auth/me Extension
Added `vc_holder_did` and `wallet_connected_at` to the `get_me` JSON response, enabling the frontend wallet settings page to show connection status.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing User struct fields in org.rs**
- **Found during:** Task 2 (cargo check)
- **Issue:** `server/src/routes/org.rs` constructs a `User` struct literal for new user creation. The struct was missing the two new `vc_holder_did` and `wallet_connected_at` fields, causing a compile error.
- **Fix:** Added `vc_holder_did: None` and `wallet_connected_at: None` to the struct literal in `add_user` handler.
- **Files modified:** server/src/routes/org.rs
- **Commit:** 0a7144c (included in Task 2 commit)

## Constraints Honored

- **WALL-05:** `server/src/auth/vc_client.rs` and `server/src/auth/vc_routes.rs` have zero changes — verified with `git diff HEAD~2` showing 0 changed lines.

## Self-Check: PASSED

Files created/modified:
- FOUND: server/src/auth/wallet_routes.rs
- FOUND: docker-compose.yml (waltid-verifier-api present, removed services absent)
- FOUND: server/src/db/schema.rs (wallet_connected_at migration)
- FOUND: server/src/db/users.rs (User struct extended, 10-column SELECTs, new DB methods)
- FOUND: server/src/auth/mod.rs (pub mod wallet_routes)
- FOUND: server/src/auth/routes.rs (vc_holder_did and wallet_connected_at in get_me)
- FOUND: server/src/routes/mod.rs (/v1/auth/wallet and /v1/auth/vc-connect registered)

Commits verified:
- FOUND: f2b2a4d
- FOUND: 0a7144c

cargo check: PASSED (0 errors)
