---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Platform
status: unknown
last_updated: "2026-02-27T16:53:12.073Z"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 8
  completed_plans: 8
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Reliable end-to-end data asset generation — a user can take heterogeneous data, transform it through Fossil pipelines, and produce a standards-compliant data asset ready for a data space
**Current focus:** Phase 12 — Walt.ID Service Reduction / External Wallet UI

## Current Position

Phase: 12 of 15 (Walt.ID Service Reduction / External Wallet UI)
Plan: 12-02 (complete — 2/2 plans done)
Status: Phase 12 Complete — backend wallet API + frontend wallet UI with QR connect flow, sidebar indicator, role-filtered settings nav.
Last activity: 2026-02-27 — 12-02 complete: wallet proxy routes, Settings > Wallet page, sidebar wallet indicator, role-filtered settings nav

Progress: [█████░░░░░] 47%

## Performance Metrics

**Velocity:**
- Total plans completed: 6 (v1.1)
- Average duration: ~5 min (v1.1)
- Total execution time: ~23 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 10 | 3/3 | 9 min | 3 min |
| 11 | 3/3 | 14 min | ~5 min |
| 12 | 2/2 | 5 min | ~3 min |

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
- [11-02]: subtle crate removed from Cargo.toml; middleware/auth.rs uses p256::elliptic_curve::subtle re-export (p256 already a dependency, avoids extra crate)
- [11-02]: org.rs add_user no longer generates temporary passwords; OIDC users created with empty password_hash, consistent with oidc_callback user creation
- [11-02]: seed.rs admin user seeded with empty password_hash; authentication goes through Keycloak in OIDC mode
- [11-03]: Invite page no-token guard uses useState default values instead of useEffect synchronous setState — avoids react-hooks/set-state-in-effect lint error with identical runtime behavior
- [11-03]: Task 2 frontend changes were already committed in Plan 11-02 branch execution — content confirmed identical to plan spec, no duplicate commit needed
- [12-01]: wallet_routes.rs placed in session_auth_routes (not api_routes) — needs session auth but NOT tenant context, parallel to /auth/me
- [12-01]: unlink_did_from_user returns Result<(), String> for consistency with other DB methods; link_did_to_user retains Result<(), rusqlite::Error>
- [Phase 12]: wallet-settings-ui sections array moved inside SettingsNav — required for dynamic role-based filtering via isPromotor state

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 11]: User migration path from Argon2id password hashes to Keycloak user store needs a concrete plan before Phase 11 planning begins (export/import strategy or one-time password reset emails).
- [Phase 11 - RESOLVED]: axum-oidc not used — openidconnect 4.0 used directly. axum-oidc 0.6 confirmed to pin reqwest 0.11 which conflicts with project's reqwest 0.12. Resolution: use openidconnect directly as planned in research.
- [Phase 12]: Audit `gaia_x/routes.rs` for Issuer API calls before removing `waltid-issuer-api` — if it calls the Issuer, removal is a separate explicitly scoped concern.
- [Phase 14]: Confirm Keycloak supports `prompt=none` silent re-authentication before Phase 14 is planned.

## Session Continuity

Last session: 2026-02-27
Stopped at: Completed 12-02-PLAN.md — Phase 12 plan 2: wallet proxy routes, Settings > Wallet page with OID4VP QR connect flow, sidebar wallet indicator, role-filtered settings nav
Resume with: `/gsd:execute-phase 13` to start Phase 13
