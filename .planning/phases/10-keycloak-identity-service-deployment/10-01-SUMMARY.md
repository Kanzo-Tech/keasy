---
phase: 10-keycloak-identity-service-deployment
plan: 01
subsystem: infra
tags: [keycloak, oidc, docker, docker-compose, postgresql, nextjs, proxy]

# Dependency graph
requires: []
provides:
  - Keycloak 26.1 + PostgreSQL Docker Compose sidecar behind keycloak profile
  - keasy realm JSON with self-registration and keasy-server OIDC client
  - Next.js /auth/* reverse proxy to internal Keycloak service
  - .env.example documenting Keycloak environment variables
affects:
  - 10-02-PLAN (OIDC config reads from Keycloak discovery document)
  - 10-03-PLAN (Keycloak admin REST API uses keasy-server service account)
  - 11-oidc-cutover (Axum OIDC middleware points to issuer URL from this plan)

# Tech tracking
tech-stack:
  added:
    - quay.io/keycloak/keycloak:26.1 (Docker image)
    - postgres:15 (Docker image, Keycloak backend)
  patterns:
    - Docker Compose profile for optional services (keycloak profile mirrors walt-id pattern)
    - KC_HTTP_RELATIVE_PATH=/auth so Keycloak serves at /auth/* without port exposure
    - Next.js rewrites() for transparent reverse proxy to internal Docker service
    - Keycloak realm JSON env var substitution for secrets (${KEASY_OIDC_CLIENT_SECRET})

key-files:
  created:
    - docker-compose.yml (keycloak-postgres and keycloak services added)
    - keycloak/realm-import/keasy-realm.json
    - .env.example
  modified:
    - web/next.config.ts (added rewrites() for /auth/* proxy)

key-decisions:
  - "Use start-dev mode (not start) — KC_HTTP_RELATIVE_PATH is runtime-configurable in start-dev; production hardening deferred to Phase 11"
  - "Keycloak served at /auth/* path prefix so Next.js proxy is a transparent pass-through (source and destination share the /auth prefix)"
  - "Both keycloak services behind keycloak Docker Compose profile — opt-in, keeps default docker compose up lightweight"
  - "KEYCLOAK_INTERNAL_URL always set on web service — harmless when Keycloak not running (connection error is expected)"
  - "Service account role mapping for manage-clients deferred to manual step in Plan 10-03 — automating in realm JSON requires version-specific clientScopeMappings structure"

patterns-established:
  - "Docker Compose profile: optional infrastructure services use profiles: [profile-name] to stay opt-in"
  - "Keycloak proxy: /auth/:path* source maps to http://keycloak:8080/auth/:path* destination — prefix preserved"

requirements-completed: [IDENT-01, IDENT-02]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 10 Plan 01: Keycloak Identity Service Deployment Summary

**Keycloak 26.1 Docker Compose sidecar with PostgreSQL persistence, keasy realm JSON bootstrap (self-registration + keasy-server OIDC client), and Next.js /auth/* reverse proxy for single-domain auth**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T12:29:30Z
- **Completed:** 2026-02-27T12:30:59Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Keycloak 26.1 + PostgreSQL sidecar defined in Docker Compose behind the `keycloak` profile — `docker compose --profile keycloak up` brings up the full identity stack
- keasy-realm.json declaratively bootstraps the keasy realm: self-registration enabled, email-as-username, keasy-server OIDC client with service accounts
- Next.js rewrites() proxy transparently routes /auth/* to the internal Keycloak container, keeping all auth URLs under the Keasy domain

## Task Commits

Each task was committed atomically:

1. **Task 1: Docker Compose — Keycloak + PostgreSQL sidecar services** - `6c3dbe5` (feat)
2. **Task 2: Realm JSON bootstrap + Next.js proxy rewrite** - `0c69501` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `docker-compose.yml` - Added keycloak-postgres and keycloak services behind keycloak profile; KEYCLOAK_INTERNAL_URL on web; commented OIDC vars on server
- `keycloak/realm-import/keasy-realm.json` - keasy realm declaration with self-registration, keasy-server OIDC client (serviceAccountsEnabled, standardFlowEnabled)
- `web/next.config.ts` - Added rewrites() proxying /auth/:path* to internal Keycloak URL
- `.env.example` - Documents KC_DB_PASSWORD, KC_ADMIN_PASSWORD, KEASY_OIDC_CLIENT_SECRET

## Decisions Made

- **start-dev mode**: Used `start-dev` (not `start`) so `KC_HTTP_RELATIVE_PATH` can be set at runtime without a custom Dockerfile build. Phase 11 hardens to production mode.
- **KC_HTTP_RELATIVE_PATH=/auth**: Keycloak serves at the /auth/* prefix internally, making the Next.js rewrite a transparent pass-through (both source and destination share the /auth prefix).
- **keycloak Docker Compose profile**: Mirrors the existing `walt-id` profile pattern — opt-in infrastructure that doesn't affect default `docker compose up`.
- **KEYCLOAK_INTERNAL_URL always set on web**: Harmless when Keycloak isn't running (requests to /auth/* return connection error, expected behavior).
- **Service account role mapping deferred**: The `manage-clients` role assignment for the keasy-server service account is documented as a manual step in Plan 10-03. Realm JSON clientScopeMappings structure varies between Keycloak releases — manual config is safer for Phase 10.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required beyond the documented `.env.example` variables. The Keycloak stack starts with defaults (`docker compose --profile keycloak up`).

## Next Phase Readiness

- Keycloak infrastructure ready — `docker compose --profile keycloak up` starts Keycloak with realm auto-imported
- Discovery document will be reachable at `http://localhost:3000/auth/realms/keasy/.well-known/openid-configuration` once running
- Plan 10-02 (OIDC config + schema + DAL) can proceed — it reads issuer URL `http://keycloak:8080/auth/realms/keasy`
- Plan 10-03 (Keycloak admin API) can proceed in Wave 2 — keasy-server service account is registered and ready for role assignment

---
*Phase: 10-keycloak-identity-service-deployment*
*Completed: 2026-02-27*
