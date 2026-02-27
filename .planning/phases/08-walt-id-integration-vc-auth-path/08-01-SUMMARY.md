---
phase: 08-walt-id-integration-vc-auth-path
plan: "01"
subsystem: backend-vc-auth
tags: [vc-auth, oid4vp, walt-id, docker, axum, sqlite]
dependency_graph:
  requires: []
  provides:
    - VC auth endpoints (vc-init, vc-status, vc-health)
    - Walt.id Docker sidecar configuration
    - AtomicBool sidecar health monitor
  affects:
    - server/src/auth/
    - server/src/db/
    - server/src/lib.rs
    - server/src/config.rs
    - server/src/main.rs
    - docker-compose.yml
tech_stack:
  added:
    - base64 = "0.22" (JWT VP token payload decoding)
  patterns:
    - Arc<AtomicBool> for lock-free cross-thread flag (vc_available)
    - Option<reqwest::Client> for optional VC feature gating
    - Background tokio::spawn loop for health monitoring
    - Same session creation pattern as email/password login
key_files:
  created:
    - server/src/auth/sidecar_health.rs
    - server/src/auth/vc_client.rs
    - server/src/auth/vc_routes.rs
  modified:
    - docker-compose.yml
    - server/src/db/schema.rs
    - server/src/db/users.rs
    - server/src/db/organizations.rs
    - server/src/config.rs
    - server/src/lib.rs
    - server/src/main.rs
    - server/src/auth/mod.rs
    - server/src/auth/errors.rs
    - server/src/routes/mod.rs
    - server/Cargo.toml
decisions:
  - Walt.id services pinned to 0.17.1 (not latest) to prevent breaking changes from image drift
  - vc-status route is public (no session required) because browser polls before auth completes
  - No DID auto-creation on first VC login — invite-only model enforced; must link DID from settings
  - update_org_vc_verified_at placed in organizations.rs (not users.rs) per domain separation
  - VcUnavailable returns 503 SERVICE_UNAVAILABLE
  - Health monitor polls /healthz every 30s; initial check runs immediately on startup
metrics:
  duration: "~4 min"
  completed: "2026-02-27"
  tasks_completed: 2
  files_changed: 11
---

# Phase 08 Plan 01: Walt.id Backend Infrastructure Summary

Walt.id Community Stack integrated as Docker sidecar with full OID4VP backend — health monitoring, Verifier API client, and three VC auth endpoints that produce standard sessions identical to email/password login.

## Tasks Completed

### Task 1: Docker sidecar, DB schema, config, health monitor, AppState extension

- **docker-compose.yml**: Added 5 walt.id services under `walt-id` profile (wallet-api, issuer-api, verifier-api, web-wallet, web-portal), all pinned to `0.17.1`. Added `KEASY_WALT_ID_VERIFIER_URL: http://waltid-verifier-api:7003` to server environment. Added 3 named volumes. `docker compose up` (no profile) is unchanged — walt.id is strictly opt-in.
- **schema.rs**: Added `vc_holder_did TEXT UNIQUE` column to users table. Nullable — only populated when a user links their DID.
- **config.rs**: Added `walt_id_verifier_url: Option<String>` field, read from `KEASY_WALT_ID_VERIFIER_URL`. Empty/missing = None = VC disabled.
- **lib.rs**: Extended `AppState` with `vc_available: Arc<AtomicBool>` and `vc_client: Option<reqwest::Client>`.
- **sidecar_health.rs**: `spawn_health_monitor()` starts a background tokio task that polls `/healthz` every 30 seconds and stores the result in the `AtomicBool` flag. Initial check runs immediately on startup.
- **main.rs**: Wires health monitor and reqwest client into AppState. Logs `"Walt.id Verifier URL not configured — VC auth disabled"` when unconfigured.

**Commit:** `9fe0caf`

### Task 2: VC auth routes, Verifier client, user-by-DID DAL, router wiring

- **errors.rs**: Added `VcUnavailable` variant → 503 `auth/vc_unavailable`.
- **vc_client.rs**: Three functions — `create_verification_session` (POST `/openid4vc/verify` with VerifiableId policy), `poll_session_status` (GET `/openid4vc/session/{id}`, 404 → expired), `extract_holder_did` (decodes VP token JWT payload for holder DID, falls back to policyResults).
- **vc_routes.rs**: `vc_init` (POST) guards on `vc_available`, calls `create_verification_session`, returns `{session_id, qr_url}`. `vc_status` (GET) polls, creates standard session on success (`cycle_id → insert user_id + auth_method=vc → set_expiry → save → upsert_user_session`), updates `org.vc_verified_at`. `vc_health` (GET) returns `{vc_available: bool}`.
- **users.rs**: Added `get_user_by_did(did)` (SELECT WHERE vc_holder_did = ? AND status = 'active') and `link_did_to_user(user_id, did)` (UPDATE SET vc_holder_did).
- **organizations.rs**: Added `update_org_vc_verified_at(org_id)` (UPDATE SET vc_verified_at = datetime('now')).
- **auth/mod.rs**: Added `pub mod sidecar_health; pub mod vc_client; pub mod vc_routes;`
- **routes/mod.rs**: Wired all three VC routes in `auth_routes` (public, no session middleware).
- **Cargo.toml**: Added `base64 = "0.22"` for JWT segment decoding.

**Commit:** `6c1c1d7`

## Verification

- `cargo check` — zero errors, zero warnings
- `docker compose config --profiles` — shows `walt-id`
- `/v1/auth/vc-init`, `/v1/auth/vc-status/{session_id}`, `/v1/auth/vc-health` confirmed in routes/mod.rs
- `vc_holder_did TEXT UNIQUE` confirmed in schema.rs line 31
- `vc_available: Arc<AtomicBool>` confirmed in lib.rs line 64

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Unused import in vc_routes.rs**
- **Found during:** Task 2 verification (`cargo check` warning)
- **Issue:** `use axum::Json;` was imported but not used in vc_routes.rs (all responses use `data_response` helper)
- **Fix:** Removed the unused import
- **Files modified:** server/src/auth/vc_routes.rs

**2. [Rule 2 - Organization] `update_org_vc_verified_at` placed in organizations.rs instead of users.rs**
- **Found during:** Task 2 implementation review
- **Issue:** Plan spec placed this function in `db/users.rs` but it operates on the `organizations` table
- **Fix:** Placed it in `db/organizations.rs` for domain separation; vc_routes.rs calls `state.db.update_org_vc_verified_at()` identically either way
- **Files modified:** server/src/db/organizations.rs (not users.rs as plan specified)

**3. [Rule 3 - Blocking] Module declarations split across tasks for incremental compilation**
- **Found during:** Task 1 — adding `pub mod vc_client; pub mod vc_routes;` to mod.rs before the files existed caused compile errors
- **Fix:** Added only `pub mod sidecar_health;` in Task 1 commit; added vc_client and vc_routes in Task 2 commit when files existed
- **Impact:** None — both are in the same final committed state

## Self-Check: PASSED

All created files confirmed on disk. Both task commits confirmed in git log.
