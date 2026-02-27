# Requirements: Keasy

**Defined:** 2026-02-27
**Core Value:** Reliable end-to-end data asset generation — a user can take heterogeneous data, transform it through Fossil pipelines, and produce a standards-compliant data asset ready for a data space

## v1.1 Requirements

Requirements for the Platform milestone. Each maps to roadmap phases.

### Identity Service

- [x] **IDENT-01**: Keycloak OIDC provider deployed as Docker sidecar with discovery document reachable from Keasy server
- [x] **IDENT-02**: Keasy registered as OIDC client in Keycloak with client_id, client_secret, and redirect URIs configured
- [ ] **IDENT-03**: User can authenticate via OIDC authorization code flow with PKCE (S256) through Keycloak
- [ ] **IDENT-04**: ID tokens include `keasy:dataspaces` custom claim with user's dataspace membership list
- [ ] **IDENT-05**: Keasy server validates ID token signature via cached JWKS with TTL and refresh-on-failure
- [ ] **IDENT-06**: Each dataspace instance validates `aud` claim matches its own registered client_id
- [ ] **IDENT-07**: Old password auth code deleted entirely (Argon2id login/register endpoints, password routes, related handlers)

### Federation

- [ ] **FED-01**: Promotor can register a dataspace instance as an OIDC client in the identity service
- [ ] **FED-02**: User sees workspace picker listing their dataspaces after authenticating at the identity service
- [ ] **FED-03**: User can switch between dataspace instances via sidebar switcher without re-entering credentials
- [ ] **FED-04**: Instance switching redirects through identity service for fresh token issuance per destination instance
- [ ] **FED-05**: SWR cache invalidated on instance switch to prevent stale role/data state

### Views

- [ ] **VIEW-01**: Promotor route group with server-side RSC role check that redirects non-promotors
- [ ] **VIEW-02**: Participant route group with server-side RSC role check that redirects non-participants
- [ ] **VIEW-03**: Promotor sidebar shows: Participants, Catalog, Compliance, Settings
- [ ] **VIEW-04**: Participant sidebar shows: Connections, Jobs, Compliance, Settings
- [ ] **VIEW-05**: Promotor can invite participant organizations from a dedicated view
- [ ] **VIEW-06**: URL structure unchanged after route group restructuring (route groups don't affect paths)

### Wallet

- [ ] **WALL-01**: Hosted walt.id Wallet, Issuer, web-wallet, and web-portal services removed from Docker Compose
- [ ] **WALL-02**: Walt.id Verifier sidecar confirmed operational standalone after other services removed
- [ ] **WALL-03**: User can connect external wallet via QR code (cross-device) or deep link (same-device) using OID4VP
- [ ] **WALL-04**: Wallet connection status visible in sidebar or settings/security page
- [ ] **WALL-05**: Existing VC verification path (`vc_client.rs`, `vc_routes.rs`) unchanged after wallet removal

### UX

- [ ] **UX-01**: Code editor occupies full available height
- [ ] **UX-02**: Save button displayed as icon-only (no text label)
- [ ] **UX-03**: Clicking settings from nav-user menu collapses the sidebar (especially on mobile)
- [ ] **UX-04**: EmptyState components use inline Link instead of button
- [ ] **UX-05**: Password change form adapts to available width (responsive)
- [ ] **UX-06**: Improved shadcn/ui component usage across the application

### Auth Migration (Frontend)

- [ ] **AUTH-01**: Login page replaced with single OIDC redirect button + optional VC auth button
- [ ] **AUTH-02**: Register page deleted entirely (Keycloak handles user registration)

### Code Quality

- [ ] **QUAL-01**: Dead code removed (unused endpoints, orphaned components, stale imports)
- [ ] **QUAL-02**: Architecture improvements following SOLID principles

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Identity Enhancements

- **IDENT-09**: UserInfo endpoint for fresh profile data without re-auth
- **IDENT-10**: Refresh token support with short-lived access tokens
- **IDENT-11**: Token revocation when user is removed from a dataspace mid-session

### Federation Enhancements

- **FED-06**: Instance health indicator (green/red dot) in workspace switcher
- **FED-07**: Polished instance registration wizard UI for promotors

### External Integration

- **EXT-01**: IDS DAPS integration for connecting to external IDSA ecosystems
- **EXT-02**: SAML SP support (via Keycloak proxy if needed)
- **EXT-03**: DID-based instance discovery

## Out of Scope

| Feature | Reason |
|---------|--------|
| Token introspection endpoint | Local JWT verification with cached JWKS is sufficient; introspection adds unnecessary network round-trips |
| Dynamic client registration (RFC 7591) | Security risk; promotor-managed registration is auditable and correct |
| Per-instance user databases | Breaks the switcher concept; central identity is the shared identity layer |
| Sliding window refresh token rotation | Over-engineering for a self-hosted tool with 24h sessions |
| Universal wallet DID auto-discovery | Adds external network calls and failure modes at login; explicit "Connect Wallet" action is correct |
| SAML alongside OIDC | Doubles identity surface area; defer to v2+ via Keycloak proxy if needed |
| OAuth/SSO login providers (Google, GitHub) | OIDC via Keycloak + VC auth covers all current use cases |
| Real-time collaboration | Single-user interactions per session |
| Mobile app | Web-only, self-hosted |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| IDENT-01 | Phase 10 | Complete |
| IDENT-02 | Phase 10 | Complete |
| FED-01 | Phase 10 | Pending |
| IDENT-03 | Phase 11 | Pending |
| IDENT-04 | Phase 11 | Pending |
| IDENT-05 | Phase 11 | Pending |
| IDENT-06 | Phase 11 | Pending |
| IDENT-07 | Phase 11 | Pending |
| AUTH-01 | Phase 11 | Pending |
| AUTH-02 | Phase 11 | Pending |
| WALL-01 | Phase 12 | Pending |
| WALL-02 | Phase 12 | Pending |
| WALL-03 | Phase 12 | Pending |
| WALL-04 | Phase 12 | Pending |
| WALL-05 | Phase 12 | Pending |
| VIEW-01 | Phase 13 | Pending |
| VIEW-02 | Phase 13 | Pending |
| VIEW-03 | Phase 13 | Pending |
| VIEW-04 | Phase 13 | Pending |
| VIEW-05 | Phase 13 | Pending |
| VIEW-06 | Phase 13 | Pending |
| FED-02 | Phase 14 | Pending |
| FED-03 | Phase 14 | Pending |
| FED-04 | Phase 14 | Pending |
| FED-05 | Phase 14 | Pending |
| UX-01 | Phase 15 | Pending |
| UX-02 | Phase 15 | Pending |
| UX-03 | Phase 15 | Pending |
| UX-04 | Phase 15 | Pending |
| UX-05 | Phase 15 | Pending |
| UX-06 | Phase 15 | Pending |
| QUAL-01 | Phase 15 | Pending |
| QUAL-02 | Phase 15 | Pending |

**Coverage:**
- v1.1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 — roadmap revised to 6 phases; IDENT-08 removed (clean-break deletion replaces session flush); QUAL-03/QUAL-04 removed and replaced by AUTH-01/AUTH-02 (now in Phase 11 alongside backend OIDC); old Phase 12 eliminated; Phases 13-16 renumbered to 12-15*
