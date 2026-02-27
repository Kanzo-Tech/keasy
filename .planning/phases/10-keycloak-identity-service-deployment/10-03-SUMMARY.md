---
phase: 10-keycloak-identity-service-deployment
plan: 03
subsystem: api
tags: [keycloak, oidc, rust, axum, reqwest, federation]

# Dependency graph
requires:
  - phase: 10-keycloak-identity-service-deployment
    provides: OIDC env vars in AppState (oidc_issuer_url, oidc_client_id, oidc_client_secret), oidc_clients DAL

provides:
  - keycloak::admin module with KeycloakAdmin (client_credentials flow, create_client, get_client_secret)
  - AppState.keycloak_admin: Option<KeycloakAdmin> — None when OIDC unconfigured
  - POST /v1/admin/oidc-clients — creates OIDC client in Keycloak, stores metadata in SQLite, returns secret once
  - GET /v1/admin/oidc-clients — lists registered instances (display metadata only, no secrets)

affects:
  - 11-oidc-cutover
  - 14-federated-dataspace-switcher

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "KeycloakAdmin::new() parses issuer URL to extract base_url and realm — caller passes full issuer URL from config"
    - "Fresh admin token per operation (no caching) — simple for Phase 10 registration volume"
    - "keycloak_admin in AppState is Option — gracefully absent when OIDC not configured"
    - "client_secret returned in POST response body but NOT stored in SQLite — one-time display"

key-files:
  created:
    - server/src/keycloak/mod.rs
    - server/src/keycloak/admin.rs
  modified:
    - server/src/lib.rs
    - server/src/main.rs
    - server/src/routes/admin.rs
    - server/src/routes/mod.rs

key-decisions:
  - "Fresh admin token per create_client call — no token caching. Registration is low-frequency; simplicity wins over optimization."
  - "client_secret NOT stored in SQLite — returned once in POST response. Promotor must save it. Matches 10-02 decision to keep secrets in Keycloak only."
  - "keycloak_admin: Option<KeycloakAdmin> in AppState — endpoint returns 500 with clear message when OIDC not configured, server starts normally without Keycloak."

patterns-established:
  - "Keycloak admin pattern: KeycloakAdmin struct built at startup from OIDC config, stored in AppState as Option, handlers check presence"

requirements-completed: [IDENT-01, IDENT-02, FED-01]

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 10 Plan 03: Keycloak Admin API + OIDC Client Registration Summary

**KeycloakAdmin Rust client (client_credentials flow) wired into AppState, plus POST /v1/admin/oidc-clients that registers dataspace instances in Keycloak and stores display metadata in SQLite**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-27T12:40:00Z
- **Completed:** 2026-02-27T12:45:00Z
- **Tasks:** 3 (Task 1 was checkpoint:human-verify — manage-clients role granted by user)
- **Files modified:** 6

## Accomplishments

- `keycloak::admin` module with `KeycloakAdmin` struct: `get_admin_token()` via client_credentials, `create_client()` extracting Keycloak UUID from Location header, `get_client_secret()` for auto-generated secret retrieval
- `AppState.keycloak_admin: Option<KeycloakAdmin>` — constructed from OIDC env vars at startup, None when unconfigured
- `POST /v1/admin/oidc-clients` — promotor-only endpoint that creates OIDC client in Keycloak, stores display metadata in SQLite, and returns client_secret exactly once (not stored)
- `GET /v1/admin/oidc-clients` — returns all registered instances (display metadata only, no secrets)

## Task Commits

Each task was committed atomically:

1. **Task 1: Grant manage-clients role** — manual human checkpoint, verified HTTP 201 (no code commit)
2. **Task 2: Keycloak admin API client module** — `c47e6d6` (feat)
3. **Task 3: POST + GET /v1/admin/oidc-clients endpoint** — `407a751` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `server/src/keycloak/mod.rs` — Keycloak module root (`pub mod admin`)
- `server/src/keycloak/admin.rs` — KeycloakAdmin struct with get_admin_token, create_client, get_client_secret
- `server/src/lib.rs` — Added `pub mod keycloak` and `keycloak_admin: Option<keycloak::admin::KeycloakAdmin>` field to AppState
- `server/src/main.rs` — Constructs KeycloakAdmin from OIDC config, wires into AppState
- `server/src/routes/admin.rs` — Added RegisterOidcClientRequest, register_oidc_client handler, list_oidc_clients handler
- `server/src/routes/mod.rs` — Mounted `/v1/admin/oidc-clients` GET + POST routes

## Decisions Made

- **Fresh token per operation:** No token caching in KeycloakAdmin. At Phase 10 registration volume (occasional), simplicity is correct. Phase 14+ can add caching if needed.
- **client_secret not stored:** POST response returns client_secret from Keycloak exactly once. Promotor must save it. Consistent with 10-02 decision — no secrets in SQLite.
- **Option<KeycloakAdmin> in AppState:** Server starts normally without OIDC configured. The endpoint returns a clear 500 error message instead of panicking.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — `cargo check` passed cleanly after each task.

## User Setup Required

None for this plan specifically. The manage-clients role was granted in Task 1 (checkpoint:human-verify, completed before this continuation).

## Next Phase Readiness

- Phase 10 complete — all three plans executed (IDENT-01, IDENT-02, FED-01 satisfied)
- Phase 11 (OIDC Cutover) can begin: Keycloak is running, keasy-server is registered as OIDC client, admin API is functional
- Phase 14 (Federated Dataspace Switcher) has its registration endpoint ready

---
*Phase: 10-keycloak-identity-service-deployment*
*Completed: 2026-02-27*
