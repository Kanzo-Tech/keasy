# Keasy

## What This Is

Keasy is a self-hosted platform for managing participation in IDSA/Gaia-X data spaces. It handles the end-to-end pipeline: from heterogeneous data sources to production-ready data assets (RDF/DCAT) suitable for publishing in a data space. Users define transformation pipelines using the Fossil DSL, connect to cloud storage providers, and generate compliant catalogs.

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
- ✓ Basic API key authentication — existing
- ✓ Docker-based self-hosted deployment — existing

### Active

**Architecture Improvements:**
- [ ] Refactor component organization — extract page-level components from reusable components, especially discovery views as dedicated pages
- [ ] Adopt TanStack Table + shadcn data-table for all tabular views (replace current specific table implementations)
- [ ] Use icon library for brand logos (Azure, Google Cloud, Amazon, Anthropic) instead of custom components
- [ ] Standardize data loading patterns across the app (evaluate SWR vs Suspense, pick one elegant approach for fast responses)
- [ ] Convert job detail views to dedicated pages (not embedded components)
- [ ] Create (data) route group layout with header / main / footer slots — list views get "Create new" buttons
- [ ] Extract shared sidebar primitives (SidebarGroup, SidebarButton) between main and settings sidebars
- [ ] Settings main content full-width layout
- [ ] Reposition save draft button in writable editor context
- [ ] Adjust graph background dot scale (smaller by default)
- [ ] Single reusable graph component for both RDF data graphs and catalog graphs (future: GPU-based rendering)
- [ ] EmptyState component links to "Create new X" for each entity type

**API Security & Quality (zero2prod-inspired):**
- [ ] Production-grade authentication and authorization on the Rust API
- [ ] API review: remove duplicates, dead code, and legacy patterns
- [ ] Apply Rust API design best practices: data-driven design, favor impl over traits, clean module organization
- [ ] Structured error handling with proper HTTP status codes and error types

**User & Organization Model:**
- [ ] User accounts with email/password authentication
- [ ] Multi-dataspace support: one account can participate in N dataspaces
- [ ] Promotor role: creates dataspace, manually registers participant organizations, assigns privileges
- [ ] Participant organizations: each has 1 admin + N users (read-only or read-write)
- [ ] Role-based access control per dataspace (promotor-assigned or role-inherited)

**Verifiable Credentials & Gaia-X Compliance:**
- [ ] walt.id integration for wallet connection and credential loading
- [ ] Two auth paths: traditional (email/password) or Verifiable Credentials
- [ ] VC sub-paths: "I have my own credentials" (load from wallet) or "Wizard" (guided Gaia-X compliance)
- [ ] Gaia-X compliance wizard (based on existing gaiax-api implementation)
- [ ] Replace current organization settings view with VC/compliance management (admin of participant)

### Out of Scope

- OAuth/SSO login providers (Google, GitHub) — defer to future milestone, email/password sufficient for v1
- IdentityHub or federated identity integration — not needed, promotor manages participants manually
- Self-service participant onboarding — promotor registers organizations manually for now
- Mobile app — web-only, self-hosted
- Real-time collaboration — single-user interactions per session

## Context

- **Domain:** IDSA/Gaia-X data spaces ecosystem. Promotors create data spaces, participants (organizations) join and share data assets.
- **Existing codebase:** Functional pipeline system (Rust backend + Next.js frontend) with Fossil DSL, RDF/DCAT, cloud connectors. Architecture needs cleanup but core pipeline works.
- **Reference implementation:** [gaiax-api](https://github.com/Kanzo-Tech/gaiax-api) for Gaia-X compliance wizard patterns.
- **Graph visualization:** Two distinct graph types — RDF data graphs (pipeline outputs) and catalog graphs (DCAT catalogs of catalogs). Currently may have duplicated components.
- **User model:** Account → N dataspaces → organizations (promotor or participant) → users. Privileges flow from promotor to organizations to users.

## Constraints

- **Deployment**: Self-hosted (Docker/K8s on own infrastructure) — no dependency on managed services
- **Auth provider**: walt.id for VCs — already evaluated and decided
- **Database**: SQLite currently — user model additions must work within SQLite or migrate to PostgreSQL
- **Tech stack**: Rust (Axum) backend, Next.js frontend, shadcn/ui components — no framework changes
- **Design principles**: SOLID, minimal code for required functionality, favor extensibility (new code over modifying existing), no over-engineering

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Email/password only for traditional auth | Simplicity, no external dependencies, OAuth deferred | — Pending |
| walt.id for VC wallet | Evaluated by team, fits Gaia-X ecosystem | — Pending |
| Promotor manually registers participants | Simpler short-term, avoids identity federation complexity | — Pending |
| TanStack Table + shadcn data-table | Standardize all tables, leverage shadcn ecosystem | — Pending |
| Priority order: arch > API > users > VCs | Architecture cleanup enables cleaner implementation of subsequent features | — Pending |

---
*Last updated: 2026-02-26 after initialization*
