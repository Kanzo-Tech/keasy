# Keasy

## What This Is

Keasy is a self-hosted multi-tenant platform for managing participation in IDSA/Gaia-X data spaces. It handles the end-to-end pipeline: from heterogeneous data sources to production-ready data assets (RDF/DCAT), with multi-organization tenant isolation, role-based access control, and Gaia-X Verifiable Credentials compliance. Users define transformation pipelines using the Fossil DSL, connect to cloud storage providers, generate compliant catalogs, and complete Gaia-X compliance certification through a guided wizard.

## Core Value

Reliable end-to-end data asset generation — a user can take heterogeneous data, transform it through Fossil pipelines, and produce a standards-compliant data asset ready for a data space.

## Requirements

### Validated

- ✓ Job creation and execution via Fossil scripts — existing
- ✓ Pipeline visualization and metadata extraction — existing
- ✓ RDF graph management (insert, query, export via Oxigraph) — existing
- ✓ Graph data discovery (search, expand, tabular views) — existing
- ✓ DCAT catalog generation from pipeline outputs — existing
- ✓ Cloud connections (S3, GCS, Azure) with encrypted credentials — existing
- ✓ Settings management (organization, AI providers, preferences) — existing
- ✓ Code editor with Fossil syntax highlighting (CodeMirror) — existing
- ✓ Docker-based self-hosted deployment — existing
- ✓ TanStack Table + shadcn data-table for all tabular views — v1.0
- ✓ SWR standardized across all client components — v1.0
- ✓ Discovery views as dedicated pages — v1.0
- ✓ Job detail views as dedicated pages — v1.0
- ✓ Route group layout with header/main/footer slots — v1.0
- ✓ Shared sidebar primitives (main + settings) — v1.0
- ✓ Settings full-width layout — v1.0
- ✓ EmptyState with contextual "Create new X" links — v1.0
- ✓ Brand icon library migration — v1.0
- ✓ Graph dot scale refinement — v1.0
- ✓ Save draft button repositioned — v1.0
- ✓ Single reusable graph component (RDF + catalog) — v1.0
- ✓ Argon2id password authentication with server-side sessions — v1.0
- ✓ Structured error handling (thiserror domain errors) — v1.0
- ✓ Domain-colocated Rust module organization — v1.0
- ✓ Dead code elimination and route audit — v1.0
- ✓ Split read/write SQLite connection pools — v1.0
- ✓ User accounts with email/password authentication — v1.0
- ✓ Multi-dataspace support (Account → N Dataspaces → Organizations → Users) — v1.0
- ✓ Promotor role: creates dataspaces, registers participants — v1.0
- ✓ Participant organizations with admin + N users (read-only/read-write) — v1.0
- ✓ Three-role RBAC (promotor/org_admin/org_user) — v1.0
- ✓ Tenant-scoped resource queries (TenantScoped<T>) — v1.0
- ✓ Email invite-based onboarding — v1.0
- ✓ Frontend login/register pages with middleware route guards — v1.0
- ✓ Dataspace switcher in sidebar — v1.0
- ✓ walt.id Docker sidecar (Issuer, Verifier, Wallet) — v1.0
- ✓ VC authentication via OID4VP — v1.0
- ✓ Wallet connection and credential loading — v1.0
- ✓ Gaia-X compliance wizard (key pair → DID → LRN → LP → T&C → GXDCH) — v1.0
- ✓ VC/compliance management replaces organization settings — v1.0

### Active

#### Current Milestone: v1.1 Platform

**Goal:** Evolve Keasy from a single multi-tenant instance to a federated platform with central identity, 1 instance = 1 dataspace architecture, and role-separated views.

**Target features:**
- Central identity service (OIDC provider, user registration, dataspace membership)
- Federated dataspace architecture (each instance = one dataspace, Slack-like switching)
- Promotor/participant view separation (strict route groups, role-scoped UI)
- Remove hosted walt.id wallet (connect to user's external wallet via OID4VP)
- UX refinements (editor full height, save icon, sidebar collapse, EmptyState links, responsive forms)
- Code quality improvements (dead code removal, SOLID principles, better shadcn usage)

### Out of Scope

- OAuth/SSO login providers (Google, GitHub) — email/password + VC auth covers all current use cases
- IdentityHub or federated identity integration — promotor manages participants manually
- Self-service participant onboarding — promotor registers organizations manually
- Mobile app — web-only, self-hosted
- Real-time collaboration — single-user interactions per session
- Offline mode — real-time tenant context is core to the platform
- Account lockout after failed attempts — defer to v1.1 hardening
- Email verification on registration — invite-only model provides implicit verification
- Audit logging — defer to v1.1

## Context

- **Domain:** IDSA/Gaia-X data spaces ecosystem. Promotors create data spaces, participants (organizations) join and share data assets.
- **Current codebase:** ~11,600 LOC Rust (Axum backend) + ~17,400 LOC TypeScript (Next.js frontend). 13 domain-colocated server modules, shadcn/ui component library.
- **Tech stack:** Rust (Axum) backend, Next.js 16 frontend, shadcn/ui, SQLite (split read/write pools), walt.id Community Stack (Docker sidecar), TanStack Table, SWR.
- **User model:** Account → N dataspaces → organizations (promotor or participant) → users. Three-role RBAC: promotor, org_admin, org_user.
- **Auth:** Dual auth paths — email/password (Argon2id + tower-sessions) and Verifiable Credentials (OID4VP via walt.id).
- **Compliance:** Gaia-X compliance wizard generates VCs (LRN, Legal Participant, T&C) and submits to GXDCH for conformance verification.
- **Reference implementation:** [gaiax-api](https://github.com/Kanzo-Tech/gaiax-api) for Gaia-X compliance patterns.

## Constraints

- **Deployment**: Self-hosted (Docker/K8s on own infrastructure) — no dependency on managed services
- **Auth provider**: walt.id for VCs — integrated and operational
- **Database**: SQLite with split read/write pools — sufficient for single-instance deployment
- **Tech stack**: Rust (Axum) backend, Next.js frontend, shadcn/ui components — no framework changes
- **Design principles**: SOLID, minimal code for required functionality, favor extensibility, no over-engineering

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Email/password only for traditional auth | Simplicity, no external dependencies, OAuth deferred | ✓ Good — works well, VC provides alternative |
| walt.id for VC wallet | Evaluated by team, fits Gaia-X ecosystem | ✓ Good — OID4VP and wallet connection operational |
| Promotor manually registers participants | Simpler short-term, avoids identity federation complexity | ✓ Good — invite flow works cleanly |
| TanStack Table + shadcn data-table | Standardize all tables, leverage shadcn ecosystem | ✓ Good — all list views migrated |
| Priority order: arch > API > users > VCs | Architecture cleanup enables cleaner implementation of subsequent features | ✓ Good — clean foundation for all later phases |
| Split read/write SQLite pools | Prevent write lock starvation under concurrent reads | ✓ Good — WAL mode + single writer eliminates contention |
| thiserror 2 for domain errors | Type-safe error handling with IntoResponse | ✓ Good — consistent error shapes across all endpoints |
| TenantScoped<T> compile-time guard | Prevent tenant data leaks at the type level | ✓ Good — cross-org access impossible without middleware injection |
| tower-sessions with signed cookies | Session management with CSRF protection | ✓ Good — persists across server restarts |
| Next.js proxy.ts (not middleware.ts) | Next.js 16.1.6 requires proxy.ts export | ✓ Good — two-list path guard works correctly |
| walt.id services pinned to 0.17.1 | Prevent breaking changes from image drift | ✓ Good — stable sidecar |
| JsonWebSignature2020 with sorted-key JSON | No Rust URDNA2015 library; GXDCH accepts this | ⚠️ Revisit — may need URDNA2015 for production GXDCH |
| Keycloak for central identity service | Industry standard, battle-tested, massive community, future-proof (SAML/LDAP/social if needed). Rauthy evaluated but rejected (pre-1.0, smaller community for security-critical service) | — Pending |

---
*Last updated: 2026-02-27 after v1.1 Platform milestone started*
