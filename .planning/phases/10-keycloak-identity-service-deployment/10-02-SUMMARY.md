---
phase: 10-keycloak-identity-service-deployment
plan: 02
subsystem: database
tags: [oidc, keycloak, sqlite, rusqlite, secrecy, config]

# Dependency graph
requires:
  - phase: 09-gaia-x-compliance-wizard
    provides: AppState and ServerConfig patterns established, DAL module conventions in db/

provides:
  - OIDC env var configuration fields in ServerConfig (oidc_issuer_url, oidc_client_id, oidc_client_secret)
  - AppState OIDC fields wired from config (ready for Plan 10-03 admin API handler)
  - oidc_clients SQLite table DDL (id, client_id, name, url, description, logo, timestamps)
  - oidc_clients DAL module with create, get, get_by_client_id, list methods
affects:
  - 10-03-keycloak-admin-api-registration-endpoint
  - 14-federated-dataspace-switcher

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OIDC env vars as Option<String> / Option<SecretString> — all optional for backward compat"
    - "resolve_secret() helper for _FILE variants of secret env vars"
    - "DAL modules follow organizations.rs pattern: write() for mutations, read() for queries"

key-files:
  created:
    - server/src/db/oidc_clients.rs
  modified:
    - server/src/config.rs
    - server/src/lib.rs
    - server/src/main.rs
    - server/src/db/schema.rs
    - server/src/db/mod.rs

key-decisions:
  - "OIDC client_secret NOT stored in oidc_clients table — secrets stay in Keycloak only to avoid stale copies and security risk"
  - "All three OIDC config fields are Option — server remains backward compatible without Keycloak"
  - "resolve_secret() used for KEASY_OIDC_CLIENT_SECRET to support both direct value and _FILE path variants"

patterns-established:
  - "OIDC config: Option<String> fields filtered on empty strings, Option<SecretString> via resolve_secret()"

requirements-completed: [IDENT-02, FED-01]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 10 Plan 02: OIDC Config + Schema + DAL Summary

**OIDC env var parsing in ServerConfig/AppState, oidc_clients SQLite table (no secret column), and DAL module with create/get/get_by_client_id/list methods following organizations.rs patterns**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-27T12:29:34Z
- **Completed:** 2026-02-27T12:31:14Z
- **Tasks:** 2
- **Files modified:** 5 (modified) + 1 (created)

## Accomplishments
- Added KEASY_OIDC_ISSUER_URL, KEASY_OIDC_CLIENT_ID, KEASY_OIDC_CLIENT_SECRET parsing to ServerConfig with empty-string filtering and _FILE variant support
- Wired three new OIDC Option fields into AppState and main.rs AppState construction
- Added oidc_clients DDL to schema.rs — no client_secret column by design
- Created oidc_clients.rs DAL module with OidcClient struct and four async methods following the exact write/read pool pattern from organizations.rs
- Registered `pub mod oidc_clients` alphabetically in db/mod.rs

## Task Commits

Each task was committed atomically:

1. **Task 1: ServerConfig OIDC env vars + AppState wiring** - `665808f` (feat)
2. **Task 2: oidc_clients table schema + DAL module** - `dcc317d` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `server/src/config.rs` - Added oidc_issuer_url, oidc_client_id, oidc_client_secret fields and from_env() parsing
- `server/src/lib.rs` - Added matching OIDC fields to AppState struct
- `server/src/main.rs` - Wired config.oidc_* fields into AppState construction
- `server/src/db/schema.rs` - Added oidc_clients CREATE TABLE IF NOT EXISTS DDL
- `server/src/db/oidc_clients.rs` - New DAL module: OidcClient struct + 4 Database impl methods
- `server/src/db/mod.rs` - Registered `pub mod oidc_clients`

## Decisions Made
- OIDC client_secret is NOT stored in the oidc_clients table — secrets live in Keycloak only. Storing them in SQLite would create a stale copy and a security risk.
- All three OIDC config fields are `Option` — the server starts and runs normally without any `KEASY_OIDC_*` env vars set (backward compatible with Phase 9 state).
- Used `resolve_secret("KEASY_OIDC_CLIENT_SECRET")` to support both direct env var and `_FILE` path variants, consistent with existing secret handling.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — cargo check passed cleanly after each task.

## User Setup Required
None - no external service configuration required for this plan. Environment variable documentation is in 10-01 (Docker Compose setup).

## Next Phase Readiness
- Plan 10-03 can now use `state.oidc_issuer_url`, `state.oidc_client_id`, `state.oidc_client_secret` to call the Keycloak admin API
- `db.create_oidc_client()` and `db.list_oidc_clients()` are ready for the instance registration endpoint
- The oidc_clients table will be created at server startup via schema.rs execute_batch

---
*Phase: 10-keycloak-identity-service-deployment*
*Completed: 2026-02-27*
