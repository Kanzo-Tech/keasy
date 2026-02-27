---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Platform
status: unknown
last_updated: "2026-02-27T16:08:07.587Z"
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 6
  completed_plans: 4
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Reliable end-to-end data asset generation — a user can take heterogeneous data, transform it through Fossil pipelines, and produce a standards-compliant data asset ready for a data space
**Current focus:** Phase 11 — OIDC Auth Conversion

## Current Position

Phase: 11 of 15 (OIDC Auth Conversion)
Plan: 11-01 (complete — 1/3 plans done)
Status: Phase 11 In Progress — backend OIDC RP core done (plan 1/3). Next: 11-02 (old auth deletion + invite flow) or 11-03 (frontend migration).
Last activity: 2026-02-27 — 11-01 complete: OIDC RP handlers, types, schema migration, DB user methods, route wiring

Progress: [███░░░░░░░] 27%

## Performance Metrics

**Velocity:**
- Total plans completed: 3 (v1.1)
- Average duration: ~4 min (v1.1)
- Total execution time: ~9 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 10 | 3/3 | 9 min | 3 min |
| 11 | 1/3 | 9 min | 9 min |

*Updated after each plan completion*

## Accumulated Context

### Decisions

- [v1.1 Roadmap rev2]: Phases simplified from 7 to 6 — Phase 11 is now a full-stack OIDC cutover (backend RP + frontend migration in one phase). Clean break: old auth code deleted entirely, no 410 deprecation, no session flushing.
- [v1.1 Roadmap rev2]: IDENT-08 (session flush) removed — not needed with clean-break deletion approach.
- [v1.1 Roadmap rev2]: QUAL-03 and QUAL-04 replaced by AUTH-01 and AUTH-02 (frontend auth migration requirements now live in Phase 11 alongside backend OIDC work).
- [v1.1 Roadmap rev2]: Old Phase 12 (Frontend Auth Migration) eliminated — work absorbed into Phase 11. Old Phases 13-16 renumbered to 12-15.
- [v1.1 Roadmap]: Identity provider: Keycloak (industry standard, battle-tested, future-proof). Rauthy evaluated and rejected (pre-1.0, smaller community).
- [v1.1 Roadmap]: Phases 12 (wallet removal) and 13 (route separation) are independent of OIDC and can run in parallel with Phase 11 if needed.
- [v1.1 Roadmap]: Phase 14 (federated switcher) is the capstone — requires Phases 10-11 complete before work begins.
- [10-01]: Use start-dev mode for Keycloak — KC_HTTP_RELATIVE_PATH is runtime-configurable in start-dev; production hardening deferred to Phase 11.
- [10-01]: Keycloak served at /auth/* path prefix so Next.js proxy is transparent pass-through; both source and destination share the /auth prefix.
- [10-01]: Service account role mapping (manage-clients) deferred to manual step in Plan 10-03 — realm JSON clientScopeMappings structure varies between Keycloak releases.
- [10-02]: OIDC client_secret NOT stored in oidc_clients table — secrets stay in Keycloak to avoid stale copies and security risk.
- [10-02]: All three OIDC config fields are Option — server remains backward compatible without Keycloak configured.
- [Phase 10-03]: Fresh admin token per create_client call — no caching; simplicity correct at Phase 10 registration volume
- [Phase 10-03]: client_secret NOT stored in SQLite — returned once in POST response; secrets stay in Keycloak only
- [Phase 10-03]: keycloak_admin: Option<KeycloakAdmin> in AppState — server starts without Keycloak, endpoint returns clear error when unconfigured
- [Phase 11]: openidconnect 4.x requires two KeyasyClient type aliases: KeyasyClientDiscovered (EndpointMaybeSet token URL from discover) and KeyasyClient (EndpointSet after set_token_uri()) — single alias approach from plan is incompatible with the 4.x type system
- [Phase 11]: OIDC errors during browser-facing flows (callback, state mismatch) return 302 redirects to /login?error=auth_failed instead of JSON — users see error banner, not raw JSON error body

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 11]: User migration path from Argon2id password hashes to Keycloak user store needs a concrete plan before Phase 11 planning begins (export/import strategy or one-time password reset emails).
- [Phase 11 - RESOLVED]: axum-oidc not used — openidconnect 4.0 used directly. axum-oidc 0.6 confirmed to pin reqwest 0.11 which conflicts with project's reqwest 0.12. Resolution: use openidconnect directly as planned in research.
- [Phase 12]: Audit `gaia_x/routes.rs` for Issuer API calls before removing `waltid-issuer-api` — if it calls the Issuer, removal is a separate explicitly scoped concern.
- [Phase 14]: Confirm Keycloak supports `prompt=none` silent re-authentication before Phase 14 is planned.

## Session Continuity

Last session: 2026-02-27
Stopped at: Completed 11-01-PLAN.md — Phase 11 plan 1/3: OIDC RP core (types, handlers, DB methods, route wiring)
Resume with: `/gsd:execute-phase 11` to execute Phase 11 plans 11-02 and 11-03
