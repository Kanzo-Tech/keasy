# Roadmap: Keasy — Auth, Multi-Tenancy, and Gaia-X VC Compliance

## Overview

Keasy is being upgraded from a single-tenant, single API-key system to a production-grade multi-tenant platform with Gaia-X Verifiable Credentials compliance. The work proceeds in strict dependency order: database schema first (nothing else is possible without it), then API architecture refactor (clean module structure, data-driven design, error handling), then auth routes and session middleware, then tenant isolation, then frontend auth, then organization management, then frontend architecture cleanup, then walt.id VC integration, and finally the Gaia-X compliance wizard. Frontend architecture improvements are largely independent and grouped into a dedicated cleanup phase.

**Git workflow:** Each phase runs on its own git branch and merges into main via pull request before the next phase begins.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: DB Schema & DAL Foundation** - Extend SQLite schema with users, organizations, dataspaces; add organization_id FK to all resource tables (completed 2026-02-26)
- [x] **Phase 2: API Architecture Refactor** - Data-driven design, module reorganization, dead code removal, structured error handling, split connection pools (completed 2026-02-26)
- [ ] **Phase 3: Auth Routes & Session Middleware** - Argon2id password auth, register/login/logout endpoints, session middleware covering all routes
- [ ] **Phase 4: Tenant Context Middleware & RBAC** - Inject TenantContext on all requests, retrofit all queries with org scoping, enforce three-role RBAC
- [ ] **Phase 5: Frontend Auth Pages & Session Management** - Login/register pages, Next.js route guards, session cookie flow, SWR 401 redirect
- [ ] **Phase 6: Dataspace Switcher & Organization Management** - Connect sidebar to real user/org data, promotor control plane, invite token onboarding
- [ ] **Phase 7: Frontend Architecture Cleanup** - TanStack Table for all list views, SWR standardization, EmptyState, route group layout, graph component unification
- [ ] **Phase 8: Walt.id Integration & VC Auth Path** - Docker sidecar setup, OID4VP auth path, VC session creation, wallet connect flow
- [ ] **Phase 9: Gaia-X Compliance Wizard** - Multi-step guided wizard: LRN → Participant → T&C → GXDCH submission; replace org settings with VC compliance management

## Phase Details

### Phase 1: DB Schema & DAL Foundation
**Goal**: The database contains all tables and foreign keys required for multi-tenant user accounts and dataspace membership, with no nullable organization_id on any resource table
**Depends on**: Nothing (first phase)
**Requirements**: USER-01, USER-02, API-09
**Success Criteria** (what must be TRUE):
  1. `organizations`, `users`, `dataspaces`, and `memberships` tables exist in the SQLite schema with all required columns and constraints
  2. `jobs`, `connections`, `cloud_accounts`, and `conversations` tables have a NOT NULL `organization_id` foreign key, backfilled with a sentinel default org for existing rows
  3. A `TenantScoped<T>` Rust newtype exists that wraps all DAL function parameters, making it a compile error to call any list/detail query without an org context
  4. DAL modules (`db/users.rs`, `db/organizations.rs`, `db/dataspaces.rs`) exist with typed query functions for all new tables
  5. All existing queries that touch resource tables compile and pass tests after the schema migration is applied
**Plans**: 2 plans
  - [ ] 01-01-PLAN.md — Schema rewrite, split read/write pools, TenantScoped type, seed data, new DAL modules
  - [ ] 01-02-PLAN.md — Retrofit existing DAL and route handlers with TenantScoped and split pool

### Phase 2: API Architecture Refactor
**Goal**: The API codebase is clean, idiomatic Rust — dead routes removed, modules organized by domain, errors typed with thiserror, connection pools split, and data-driven design applied throughout
**Depends on**: Phase 1
**Requirements**: API-07, API-08, API-09, API-10
**Success Criteria** (what must be TRUE):
  1. All duplicate and dead API routes are removed; the route tree reflects only active, used endpoints with no commented-out or legacy handlers
  2. The SQLite write pool has `max_connections = 1` with WAL mode enabled; read pool has multiple connections; pool split is enforced at the AppState level
  3. All fallible API operations return a typed domain error via `thiserror`; error-to-HTTP-status mapping lives in a single place (no ad-hoc `StatusCode` construction scattered across handlers)
  4. Module organization follows domain boundaries (auth, jobs, connections, cloud_accounts, etc.); `impl` blocks are favored over trait objects where behavior is not genuinely polymorphic
  5. The codebase compiles with no warnings on `cargo build`; `cargo clippy` reports no lints beyond allowed exceptions
**Plans**: 2 plans
  - [ ] 02-01-PLAN.md — Error handling foundation, cross-cutting infrastructure (thiserror, AppError, data_response, SpawnParams, frontend envelope)
  - [ ] 02-02-PLAN.md — Domain module reorganization, handler refactor, route audit, final cleanup

### Phase 02.1: Domain consolidation — merge scattered modules into cohesive domain folders (INSERTED)

**Goal:** Every server source file lives in the domain folder it belongs to, following the domain-colocated structure established in Phase 2 — scattered top-level modules (graph, dcat, rdf, validation, pipeline, script, conversations, cloud) are dissolved into their parent domains (discovery, jobs, ai, cloud_accounts), reducing the module count from 20 to 13-14
**Requirements**: API-10
**Depends on:** Phase 2
**Success Criteria** (what must be TRUE):
  1. `conversations/` is absorbed into `ai/`; `cloud/` is absorbed into `cloud_accounts/`
  2. `graph/` is renamed to `discovery/` and absorbs `dcat/`, `rdf/`, and `validation/`
  3. `pipeline/` and `script/` are absorbed into `jobs/`
  4. `main.rs` declares only the consolidated top-level modules — no dissolved module declarations remain
  5. `cargo build && cargo clippy -- -D warnings` passes with zero errors and zero warnings
  6. All API endpoints are unchanged — no behavior changes, no new endpoints, no removed endpoints
**Plans:** 2/2 plans complete

Plans:
  - [x] 02.1-01-PLAN.md — Absorb conversations/ into ai/, absorb cloud/ into cloud_accounts/ (completed 2026-02-26)
  - [ ] 02.1-02-PLAN.md — Create discovery/ domain (rename graph/, absorb dcat/+rdf/+validation/), absorb pipeline/+script/ into jobs/, final cleanup

### Phase 3: Auth Routes & Session Middleware
**Goal**: Users can register and log in with email and password via server-side sessions, and all API routes except public health/auth endpoints require authentication
**Depends on**: Phase 2
**Requirements**: API-01, API-02, API-03, API-04, API-05
**Success Criteria** (what must be TRUE):
  1. A new user can POST to `/v1/auth/register` with email and password and receive a session cookie; password is stored as Argon2id hash
  2. A returning user can POST to `/v1/auth/login` and receive a session cookie that persists across server restarts (SQLite-backed session store)
  3. A logged-in user can POST to `/v1/auth/logout` and immediately lose access — subsequent authenticated requests with the old cookie return 401
  4. Every non-public API endpoint returns 401 for requests with no valid session cookie; a security smoke test asserts this for all routes
  5. The API returns consistent error shapes: 401 for unauthenticated, 403 for unauthorized, mapped from the typed domain errors introduced in Phase 2
**Plans**: TBD

### Phase 4: Tenant Context Middleware & RBAC
**Goal**: Every authenticated request carries an injected TenantContext, all existing resource queries are filtered by organization_id, and role-based access is enforced at the API layer — not scattered in handler bodies
**Depends on**: Phase 3
**Requirements**: API-06, USER-09
**Success Criteria** (what must be TRUE):
  1. A `TenantContext` struct is injected into all authenticated request extensions by middleware; route handlers that extract it fail at compile time if tenant context is missing
  2. A user from Organization A cannot see jobs, connections, or cloud accounts belonging to Organization B — verified by integration tests on every list and detail endpoint
  3. A `RequireRole` custom extractor enforces promotor/org_admin/org_user role checks at the handler boundary — no role checks exist inside handler bodies
  4. Attempting to access a resource owned by another org returns 403, not 404 or 200 with empty data
**Plans**: TBD

### Phase 5: Frontend Auth Pages & Session Management
**Goal**: Users access Keasy through a login page, unauthenticated routes redirect to login, and session expiry is handled gracefully without a flood of API errors
**Depends on**: Phase 4
**Requirements**: USER-12
**Success Criteria** (what must be TRUE):
  1. An unauthenticated user who visits any main app route is redirected to `/login`
  2. A user can log in at `/login` with email and password and land on the main dashboard with their session established
  3. A user can register at `/register` and immediately access the app
  4. When a session expires mid-session, SWR's 401 error handler redirects to `/login` instead of showing API errors
  5. The login and register pages have no sidebar and exist in the `(auth)` route group; all other pages require a valid session via Next.js middleware
**Plans**: TBD

### Phase 6: Dataspace Switcher & Organization Management
**Goal**: The sidebar shows real user identity and real dataspaces; promotors can create dataspaces and invite org admins; org admins can manage their users
**Depends on**: Phase 5
**Requirements**: USER-03, USER-04, USER-05, USER-06, USER-07, USER-08, USER-10, USER-11, USER-13, USER-14
**Success Criteria** (what must be TRUE):
  1. The sidebar displays the logged-in user's real name and email; the team switcher shows actual dataspaces the user belongs to
  2. A promotor can create a dataspace and is automatically assigned the promotor role within it
  3. A promotor can register a participant organization, set its name, and send an invite token to the designated org admin's email
  4. An org admin who accepts an invite token can log in and see their organization's users; they can add users with read-only or read-write roles and remove existing users
  5. A user belonging to multiple dataspaces can switch between them in the sidebar; switching updates the active tenant context for all subsequent actions
  6. A user can change their own password from the settings page using a form that requires current password, new password, and confirmation
**Plans**: TBD

### Phase 7: Frontend Architecture Cleanup
**Goal**: All list views use TanStack Table, all client data fetching uses SWR consistently, the component tree is organized with page-specific logic in route files, and discovery/job detail views are dedicated pages
**Depends on**: Phase 5 (route group layout requires auth route groups from Phase 5, but most work is independent)
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-05, ARCH-06, ARCH-07, ARCH-08, ARCH-09, ARCH-10, ARCH-11, ARCH-12
**Success Criteria** (what must be TRUE):
  1. Every list view (jobs, connections, cloud accounts, users, organizations) renders via TanStack Table + shadcn data-table with sorting, filtering, and column selection working
  2. All client-side data fetching uses SWR with a consistent hook pattern; no raw `fetch` calls exist in client components, and stable per-session data (settings, user profile) uses async server components instead of SWR
  3. Discovery views (graph explorer, DCAT catalog browser) are navigable via the route tree as dedicated pages, not embedded components inside other pages
  4. Job detail views open as dedicated pages (e.g. `/jobs/[id]`) rather than rendering inside a list or modal; the writable editor's save draft button is positioned within the editor context
  5. A single reusable graph component handles both RDF data graphs and catalog graphs via configurable data adapters; brand logos (Azure, Google Cloud, Amazon, Anthropic) use an icon library
  6. Empty list views show a contextual "Create new X" link that navigates to the creation flow for that entity type
**Plans**: TBD

### Phase 8: Walt.id Integration & VC Auth Path
**Goal**: Walt.id Community Stack runs alongside Keasy as a Docker sidecar; users can authenticate via Verifiable Credentials (OID4VP) as an alternative to email/password, producing the same session type
**Depends on**: Phase 5
**Requirements**: VC-01, VC-02, VC-03, VC-08, VC-09
**Success Criteria** (what must be TRUE):
  1. The Docker Compose file includes all five walt.id services (Issuer :7002, Verifier :7003, Wallet :7001, plus supporting services); all ports are reachable from the Rust API in a local dev environment
  2. A user visiting the login page sees two options: "Email & Password" and "Verifiable Credentials"; selecting VC starts an OID4VP flow
  3. A user with existing Verifiable Credentials can connect their walt.id wallet and load credentials into the app
  4. A user who completes the OID4VP flow receives the same server-side session cookie as a user who logs in with email/password — the rest of the app behaves identically
  5. VC compliance status is cached in the `organizations` table with a `vc_verified_at` timestamp; walt.id sidecar unavailability does not break email/password login
**Plans**: TBD

### Phase 9: Gaia-X Compliance Wizard
**Goal**: Org admins can complete a guided multi-step wizard that generates Gaia-X Verifiable Credentials, submits them to GXDCH for compliance verification, and replaces the current organization settings view with VC compliance management
**Depends on**: Phase 8, Phase 6
**Requirements**: VC-04, VC-05, VC-06, VC-07, VC-10
**Success Criteria** (what must be TRUE):
  1. An org admin can start the compliance wizard and progress through all steps: key pair generation, DID document hosting, LRN credential, Legal Participant credential, Terms & Conditions credential, and GXDCH submission
  2. The wizard validates the X.509 certificate chain (including explicit root CA, not just fullchain.pem) at each step before proceeding — not only at final submission
  3. The generated Verifiable Presentation contains all credentials inline as objects (not URL references); credential linking uses `credentialSubject.id`, not the top-level credential `id`
  4. After successful GXDCH submission, the org admin sees a compliance status indicator showing their organization is Gaia-X conformant
  5. The organization settings page is replaced by the VC/compliance management view accessible to org admins
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
(Phase 7 can overlap with Phase 6 — no hard dependency between them)

Each phase runs on its own git branch and merges into main via pull request before the next phase begins.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. DB Schema & DAL Foundation | 2/2 | Complete    | 2026-02-26 |
| 2. API Architecture Refactor | 2/2 | Complete    | 2026-02-26 |
| 02.1. Domain Consolidation | 2/2 | Complete    | 2026-02-26 |
| 3. Auth Routes & Session Middleware | 1/2 | In Progress|  |
| 4. Tenant Context Middleware & RBAC | 0/TBD | Not started | - |
| 5. Frontend Auth Pages & Session Management | 0/TBD | Not started | - |
| 6. Dataspace Switcher & Organization Management | 0/TBD | Not started | - |
| 7. Frontend Architecture Cleanup | 0/TBD | Not started | - |
| 8. Walt.id Integration & VC Auth Path | 0/TBD | Not started | - |
| 9. Gaia-X Compliance Wizard | 0/TBD | Not started | - |
