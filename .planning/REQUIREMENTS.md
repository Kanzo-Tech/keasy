# Requirements: Keasy

**Defined:** 2026-02-26
**Core Value:** Reliable end-to-end data asset generation for IDSA/Gaia-X data spaces

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Frontend Architecture

- [ ] **ARCH-01**: All list views (jobs, connections, cloud accounts, users, orgs) use TanStack Table + shadcn data-table with sorting, filtering, and column selection
- [ ] **ARCH-02**: Data loading uses SWR consistently across all client components with a standardized pattern (no raw fetch, no mixed approaches)
- [ ] **ARCH-03**: Discovery views are dedicated pages under the route tree, not embedded components
- [ ] **ARCH-04**: Job detail views are dedicated pages (not embedded components)
- [ ] **ARCH-05**: (data) route group layout has header / main (full height) / footer slots with "Create new" buttons on list pages
- [ ] **ARCH-06**: Shared sidebar primitives (SidebarGroup, SidebarButton) extracted and reused between main sidebar and settings sidebar
- [ ] **ARCH-07**: Settings main content occupies full available width
- [ ] **ARCH-08**: EmptyState component shows contextual "Create new X" link for each entity type (job, connection, cloud account, etc.)
- [ ] **ARCH-09**: Single reusable graph component handles both RDF data graphs and catalog graphs with configurable data adapters
- [ ] **ARCH-10**: Brand logos (Azure, Google Cloud, Amazon, Anthropic) use an icon library instead of custom components
- [ ] **ARCH-11**: Graph background dot scale is smaller by default
- [ ] **ARCH-12**: Save draft button repositioned within the writable editor context

### API Security & Quality

- [x] **API-01**: User can register with email and password (Argon2id hashing, spawn_blocking)
- [x] **API-02**: User can log in with email and password, receiving a server-side session cookie
- [x] **API-03**: User can log out, immediately invalidating their session
- [x] **API-04**: All API routes (except /health, /login, /register) require authentication via session middleware at the top-level router
- [x] **API-05**: API returns 401 for unauthenticated requests and 403 for unauthorized requests, with consistent error shapes
- [x] **API-06**: Role-based access control enforced at API layer: promotor, org_admin, org_user roles checked per endpoint
- [x] **API-07**: All existing API routes reviewed: duplicates removed, dead code eliminated, legacy patterns replaced
- [x] **API-08**: Structured error handling with thiserror domain error types mapped to consistent HTTP status codes
- [x] **API-09**: SQLite write pool split from read pool (max_connections=1 for writes) to prevent lock starvation
- [x] **API-10**: API follows Rust best practices: data-driven design, favor impl over traits, clean module organization

### User & Organization Model

- [x] **USER-01**: User accounts with email, hashed password, and profile (name)
- [x] **USER-02**: Database schema supports: Account → N Dataspaces → Organizations (promotor or participant) → Users
- [x] **USER-03**: Promotor can create a dataspace and is automatically assigned the promotor role
- [x] **USER-04**: Promotor can register participant organizations manually within a dataspace
- [x] **USER-05**: Promotor can assign privileges to participant organizations (role-based or manual)
- [x] **USER-06**: Each participant organization has 1 admin user who manages their org's users
- [x] **USER-07**: Org admin can add users with read-only or read-write roles within their organization
- [x] **USER-08**: Org admin can remove users from their organization
- [x] **USER-09**: All resource queries (jobs, connections, cloud accounts, conversations) are tenant-scoped by organization_id
- [x] **USER-10**: User can change their own password (current + new + confirmation)
- [x] **USER-11**: Promotor can send email invite tokens to onboard org admins
- [x] **USER-12**: Frontend login page with email/password form and route guards (redirect unauthenticated users)
- [ ] **USER-13**: Frontend shows real user data in sidebar (name, email, avatar) and real team/org in team switcher
- [ ] **USER-14**: Dataspace switcher in sidebar for users belonging to multiple dataspaces

### Verifiable Credentials & Gaia-X

- [ ] **VC-01**: walt.id Community Stack runs as Docker sidecar services (Issuer, Verifier, Wallet) alongside Keasy
- [ ] **VC-02**: User can connect a wallet via walt.id and load existing Verifiable Credentials
- [ ] **VC-03**: User can log in via Verifiable Credentials (OID4VP) as an alternative to email/password, producing the same session type
- [ ] **VC-04**: Gaia-X compliance wizard guides user through: key pair generation, DID document hosting, LRN credential, Legal Participant credential, T&C credential, and GXDCH compliance submission
- [ ] **VC-05**: Wizard validates certificate chain (including root CA) at each step, not only at final submission
- [ ] **VC-06**: Credentials are linked via credential subject ID (not top-level credential ID) per Gaia-X specification
- [ ] **VC-07**: All credentials in Verifiable Presentations are included inline (not URL references)
- [ ] **VC-08**: Two auth paths available at login: "Traditional" (email/password) and "Verifiable Credentials"
- [ ] **VC-09**: Within VC path, two sub-options: "I have my own credentials" (load from wallet) and "Wizard" (guided Gaia-X compliance)
- [ ] **VC-10**: VC/compliance management replaces current organization settings view (accessible by org admin)

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Authentication Enhancements

- **AUTH-01**: OAuth/SSO providers (Google, GitHub) as additional login options
- **AUTH-02**: Account lockout after N failed login attempts
- **AUTH-03**: Email verification on registration

### Advanced Features

- **ADV-01**: Audit log for all sensitive operations (user creation, role changes, credential issuance)
- **ADV-02**: GPU-based graph rendering for large datasets
- **ADV-03**: Credential revocation (Bitstring Status List) for issued VCs
- **ADV-04**: VC credential management UI (view credentials, expiry, compliance status)
- **ADV-05**: Self-service participant onboarding (future, when governance model evolves)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time collaboration (WebSocket cursors, CRDT) | Pipeline authoring is single-user; optimistic locking sufficient |
| Stateless JWT for user sessions | Cannot guarantee logout/revocation; server-side sessions are correct for this use case |
| Custom role definitions | Fixed role set (promotor, org_admin, org_user) covers all data space use cases; custom RBAC adds complexity without benefit |
| Per-resource ACLs (per-job permissions) | Org-level scoping is the natural access unit; fine-grained ACLs are over-engineering |
| Mobile native app | Desktop-first tool (code editing, graph viz); responsive web sufficient |
| Email notifications (job completion) | Requires SMTP in self-hosted context; in-app status + SWR polling sufficient |
| IdentityHub / federated identity | Promotor manages participants manually; no external identity federation |
| PostgreSQL migration | SQLite sufficient for self-hosted single-instance; evaluate if multi-instance needed |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | Phase 7 | Pending |
| ARCH-02 | Phase 7 | Pending |
| ARCH-03 | Phase 7 | Pending |
| ARCH-04 | Phase 7 | Pending |
| ARCH-05 | Phase 7 | Pending |
| ARCH-06 | Phase 7 | Pending |
| ARCH-07 | Phase 7 | Pending |
| ARCH-08 | Phase 7 | Pending |
| ARCH-09 | Phase 7 | Pending |
| ARCH-10 | Phase 7 | Pending |
| ARCH-11 | Phase 7 | Pending |
| ARCH-12 | Phase 7 | Pending |
| API-01 | Phase 3 | Complete |
| API-02 | Phase 3 | Complete |
| API-03 | Phase 3 | Complete |
| API-04 | Phase 3 | Complete |
| API-05 | Phase 3 | Complete |
| API-06 | Phase 4 | Complete |
| API-07 | Phase 2 | Complete |
| API-08 | Phase 2 | Complete |
| API-09 | Phase 2 | Complete |
| API-10 | Phase 2 | Complete |
| USER-01 | Phase 1 | Complete |
| USER-02 | Phase 1 | Complete |
| USER-03 | Phase 6 | Complete |
| USER-04 | Phase 6 | Complete |
| USER-05 | Phase 6 | Complete |
| USER-06 | Phase 6 | Complete |
| USER-07 | Phase 6 | Complete |
| USER-08 | Phase 6 | Complete |
| USER-09 | Phase 4 | Complete |
| USER-10 | Phase 6 | Complete |
| USER-11 | Phase 6 | Complete |
| USER-12 | Phase 5 | Complete |
| USER-13 | Phase 6 | Pending |
| USER-14 | Phase 6 | Pending |
| VC-01 | Phase 8 | Pending |
| VC-02 | Phase 8 | Pending |
| VC-03 | Phase 8 | Pending |
| VC-04 | Phase 9 | Pending |
| VC-05 | Phase 9 | Pending |
| VC-06 | Phase 9 | Pending |
| VC-07 | Phase 9 | Pending |
| VC-08 | Phase 8 | Pending |
| VC-09 | Phase 8 | Pending |
| VC-10 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 46 total
- Mapped to phases: 46
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after roadmap revision (Phase 2 split into Phase 2 + Phase 3; all subsequent phases shifted by 1)*
