# Roadmap: Keasy

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-02-27)
- 🚧 **v1.1 Platform** — Phases 10-15 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-9) — SHIPPED 2026-02-27</summary>

- [x] Phase 1: DB Schema & DAL Foundation (2/2 plans) — completed 2026-02-26
- [x] Phase 2: API Architecture Refactor (2/2 plans) — completed 2026-02-26
- [x] Phase 02.1: Domain Consolidation (2/2 plans) — completed 2026-02-26 [INSERTED]
- [x] Phase 3: Auth Routes & Session Middleware (3/3 plans) — completed 2026-02-26
- [x] Phase 4: Tenant Context Middleware & RBAC (3/3 plans) — completed 2026-02-26
- [x] Phase 5: Frontend Auth Pages & Session Management (3/3 plans) — completed 2026-02-26
- [x] Phase 6: Dataspace Switcher & Organization Management (3/3 plans) — completed 2026-02-26
- [x] Phase 6.1: Middleware Route Guard Fix (1/1 plan) — completed 2026-02-26 [INSERTED]
- [x] Phase 7: Frontend Architecture Cleanup (4/4 plans) — completed 2026-02-26
- [x] Phase 8: Walt.id Integration & VC Auth Path (3/3 plans) — completed 2026-02-27
- [x] Phase 9: Gaia-X Compliance Wizard (4/4 plans) — completed 2026-02-27

Full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 🚧 v1.1 Platform (In Progress)

**Milestone Goal:** Evolve Keasy from a single multi-tenant instance to a federated platform with central identity (Keycloak), 1 instance = 1 dataspace architecture, role-separated views, and external wallet connection.

- [x] **Phase 10: Keycloak Identity Service Deployment** - Deploy Keycloak Docker sidecar, register Keasy as OIDC client, and register first dataspace instance (completed 2026-02-27)
- [ ] **Phase 11: OIDC Auth Conversion** - Full-stack OIDC cutover: Axum becomes OIDC RP, login page replaced, register page deleted, old auth code removed entirely
- [ ] **Phase 12: Walt.id Service Reduction & External Wallet UI** - Remove hosted wallet services; add external wallet connect via OID4VP
- [ ] **Phase 13: Promotor/Participant Route Separation** - Enforce role-separated route groups with server-side RSC checks and role-scoped sidebars
- [ ] **Phase 14: Federated Instance Switcher** - Workspace picker and cross-instance switching backed by identity service membership claims
- [ ] **Phase 15: UX Polish & Code Quality** - Editor height, save icon, sidebar collapse, EmptyState links, responsive forms, dead code removal

## Phase Details

### Phase 10: Keycloak Identity Service Deployment
**Goal**: Keycloak is running as a Docker sidecar, Keasy is registered as an OIDC client, and the first dataspace instance is registered — unblocking all OIDC relying party work
**Depends on**: Phase 9 (v1.0 complete)
**Requirements**: IDENT-01, IDENT-02, FED-01
**Success Criteria** (what must be TRUE):
  1. Keycloak discovery document (`/.well-known/openid-configuration`) is reachable from the Keasy server container
  2. Keasy's `client_id`, `client_secret`, and redirect URIs are configured in Keycloak and the OIDC environment variables are set in the server
  3. A promotor can register a dataspace instance as an OIDC client in the identity service (the `oidc_clients` table exists and accepts entries)
  4. The Keycloak container starts with the existing Docker Compose setup without breaking existing services
**Plans**: 3 (10-01 Docker Compose infra, 10-02 Server config + schema + DAL, 10-03 Keycloak admin API + endpoint)

### Phase 11: OIDC Auth Conversion
**Goal**: Authentication is entirely OIDC-based across the full stack — the Axum server handles the authorization code flow with PKCE, the login page presents a single OIDC redirect, the register page is deleted, and all old password auth code is removed with no legacy path remaining
**Depends on**: Phase 10
**Requirements**: IDENT-03, IDENT-04, IDENT-05, IDENT-06, IDENT-07, AUTH-01, AUTH-02
**Success Criteria** (what must be TRUE):
  1. User can authenticate via OIDC authorization code flow with PKCE (S256) — `/v1/auth/oidc-start` and `/v1/auth/oidc-callback` complete the full round-trip and create a `keasy.sid` session
  2. ID tokens include a `keasy:dataspaces` custom claim and the server validates the `aud` claim against its own registered `client_id`
  3. JWKS signature validation uses a cached key set with TTL and refresh-on-failure behavior
  4. The login page shows a single "Sign in" button (plus optional VC auth button) with no email/password fields; clicking it redirects to Keycloak and returns the user with a valid session
  5. The register page no longer exists at any route — Keycloak handles user registration
  6. All old Argon2id login/register endpoint code, password route handlers, and related password auth modules are deleted from the codebase (not deprecated, not returning 410 — removed entirely)
**Plans**: TBD

### Phase 12: Walt.id Service Reduction & External Wallet UI
**Goal**: Hosted wallet services are removed from Docker Compose; users can connect an external wallet via OID4VP; the Verifier sidecar operates standalone and VC verification is unbroken
**Depends on**: Phase 9 (v1.0 complete — independent of OIDC phases)
**Requirements**: WALL-01, WALL-02, WALL-03, WALL-04, WALL-05
**Success Criteria** (what must be TRUE):
  1. `waltid-wallet-api`, `waltid-issuer-api`, `waltid-web-wallet`, and `waltid-web-portal` are removed from Docker Compose and the stack starts cleanly without them
  2. The walt.id Verifier sidecar operates standalone — existing `/v1/vc/*` verification routes respond correctly after the other services are removed
  3. User can connect an external wallet via QR code (cross-device) or deep link (same-device) using the `openid4vp://authorize` scheme
  4. Wallet connection status is visible in the sidebar or settings/security page
**Plans**: TBD

### Phase 13: Promotor/Participant Route Separation
**Goal**: Promotor and participant users see strictly separated route groups with server-side role enforcement; URL structure is unchanged; each role sees only their relevant sidebar items
**Depends on**: Phase 9 (v1.0 complete — independent of OIDC and wallet phases)
**Requirements**: VIEW-01, VIEW-02, VIEW-03, VIEW-04, VIEW-05, VIEW-06
**Success Criteria** (what must be TRUE):
  1. A non-promotor navigating to any promotor route is redirected server-side (RSC layout check) before any client JS runs
  2. A non-participant navigating to any participant route is redirected server-side before any client JS runs
  3. Promotor sidebar shows exactly: Participants, Catalog, Compliance, Settings — participant sidebar shows exactly: Connections, Jobs, Compliance, Settings
  4. A promotor can invite participant organizations from a dedicated view
  5. All v1.0 URLs resolve identically after route group restructuring (parenthesis folder names do not appear in URLs)
**Plans**: TBD

### Phase 14: Federated Instance Switcher
**Goal**: Users see a workspace picker listing their dataspaces after authenticating; they can switch between instances via the sidebar without re-entering credentials; SWR cache is invalidated on switch to prevent stale state
**Depends on**: Phase 11 (OIDC phases 10-11 complete — identity service must be issuing tokens with membership claims)
**Requirements**: FED-02, FED-03, FED-04, FED-05
**Success Criteria** (what must be TRUE):
  1. After authenticating at the identity service, the user sees a workspace picker listing all dataspaces from the `keasy:dataspaces` claim in their ID token
  2. User can switch between dataspace instances via the sidebar switcher without re-entering credentials
  3. Switching instances triggers a redirect through the identity service for fresh token issuance to the destination instance
  4. SWR cache (including `/api/auth/me`) is invalidated on instance switch — the sidebar reflects the correct role for the new instance immediately
**Plans**: TBD

### Phase 15: UX Polish & Code Quality
**Goal**: UX friction points are resolved; dead code is removed; the codebase follows SOLID principles with improved shadcn/ui usage throughout
**Depends on**: Phase 14 (all core features stable)
**Requirements**: UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):
  1. The code editor occupies the full available height of the viewport; the save button shows an icon only (no text label)
  2. Clicking settings from the nav-user menu collapses the sidebar (works correctly on mobile)
  3. EmptyState components use inline links instead of buttons; the password change form is responsive to available width
  4. Dead code (unused endpoints, orphaned components, stale imports) is removed and the project compiles without warnings
  5. shadcn/ui component usage is consistent and idiomatic across the application
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. DB Schema & DAL Foundation | v1.0 | 2/2 | Complete | 2026-02-26 |
| 2. API Architecture Refactor | v1.0 | 2/2 | Complete | 2026-02-26 |
| 02.1. Domain Consolidation | v1.0 | 2/2 | Complete | 2026-02-26 |
| 3. Auth Routes & Session Middleware | v1.0 | 3/3 | Complete | 2026-02-26 |
| 4. Tenant Context Middleware & RBAC | v1.0 | 3/3 | Complete | 2026-02-26 |
| 5. Frontend Auth Pages & Session Management | v1.0 | 3/3 | Complete | 2026-02-26 |
| 6. Dataspace Switcher & Organization Management | v1.0 | 3/3 | Complete | 2026-02-26 |
| 6.1. Middleware Route Guard Fix | v1.0 | 1/1 | Complete | 2026-02-26 |
| 7. Frontend Architecture Cleanup | v1.0 | 4/4 | Complete | 2026-02-26 |
| 8. Walt.id Integration & VC Auth Path | v1.0 | 3/3 | Complete | 2026-02-27 |
| 9. Gaia-X Compliance Wizard | v1.0 | 4/4 | Complete | 2026-02-27 |
| 10. Keycloak Identity Service Deployment | 3/3 | Complete    | 2026-02-27 | - |
| 11. OIDC Auth Conversion | v1.1 | 0/TBD | Not started | - |
| 12. Walt.id Service Reduction & External Wallet UI | v1.1 | 0/TBD | Not started | - |
| 13. Promotor/Participant Route Separation | v1.1 | 0/TBD | Not started | - |
| 14. Federated Instance Switcher | v1.1 | 0/TBD | Not started | - |
| 15. UX Polish & Code Quality | v1.1 | 0/TBD | Not started | - |
