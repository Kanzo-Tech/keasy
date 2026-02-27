---
phase: 08-walt-id-integration-vc-auth-path
plan: 02
subsystem: auth
tags: [vc, oid4vp, qr-code, react-qr-code, swr, nextjs, proxy, walt-id, gaia-x]

# Dependency graph
requires:
  - phase: 08-walt-id-integration-vc-auth-path-01
    provides: Walt.id sidecar Docker config, vc-health/vc-init/vc-status backend endpoints
  - phase: 05-next-js-frontend-foundation
    provides: Auth layout, login/register pages, proxy.ts route guard pattern

provides:
  - Login page with VC health check (SWR) and VC link below "or" divider
  - /login/vc page with QR code OID4VP flow, polling, step indicator, auto-refresh
  - /login/vc/coming-soon static description stub for Gaia-X wizard
  - /api/auth/vc-health GET proxy (returns vc_available flag, graceful fallback)
  - /api/auth/vc-init POST proxy (initiates OID4VP session)
  - /api/auth/vc-status/[sessionId] GET proxy with Set-Cookie forwarding for session establishment

affects:
  - phase: 09-gxdch-integration (VC login flow, Coming Soon stub)
  - auth routes, proxy middleware

# Tech tracking
tech-stack:
  added:
    - react-qr-code v2.0.18 (QR code rendering for OID4VP presentation URI)
  patterns:
    - SWR-based health polling for feature availability (vcHealth with 30s refresh)
    - Disabled UI pattern: VC link shown as muted non-clickable text when sidecar unavailable
    - useRef timer pattern for polling (pollingRef, qrTimerRef) with cleanup on unmount
    - Set-Cookie header forwarding in Next.js proxy routes (getSetCookie array iteration)

key-files:
  created:
    - web/src/app/(auth)/login/vc/page.tsx
    - web/src/app/(auth)/login/vc/coming-soon/page.tsx
    - web/src/app/api/auth/vc-health/route.ts
    - web/src/app/api/auth/vc-init/route.ts
    - web/src/app/api/auth/vc-status/[sessionId]/route.ts
  modified:
    - web/src/app/(auth)/login/page.tsx
    - web/package.json

key-decisions:
  - "VC link on login page shows as disabled muted text (not a Link) when sidecar unavailable — prevents broken navigation"
  - "Layout.tsx kept as two-column wrapper; VC pages use flex-col centered layout (escape the grid via full-height) — avoids layout nesting issues for auth-only sub-pages"
  - "Verifier only returns pending/authenticated/expired — step indicator maps pending->scan, transition->verifying, success->done (no real wallet-connected intermediate state)"
  - "Coming Soon page has no interactions per deferred decisions — static description only"
  - "proxy.ts unchanged: AUTH_REDIRECT_PATHS ['/login'] already covers /login/vc via startsWith check"

patterns-established:
  - "SWR health check pattern: useSWR with refreshInterval:30000 and fallbackData for graceful degradation"
  - "VC proxy routes: vc-health/vc-init are simple passthrough; vc-status must forward Set-Cookie (same as login route)"
  - "QR auto-refresh: qrTimerRef tracks 5-minute timeout, initSession() re-called on expiry"

requirements-completed:
  - VC-08
  - VC-09

# Metrics
duration: 12min
completed: 2026-02-27
---

# Phase 08 Plan 02: VC Auth Frontend Summary

**Login page with OID4VP QR flow via react-qr-code, SWR health check for VC availability, step indicator, and Next.js proxy routes for Walt.id sidecar (vc-health, vc-init, vc-status with Set-Cookie forwarding)**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-02-27T00:00:00Z
- **Completed:** 2026-02-27
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Login page upgraded with VC health check (SWR, 30s refresh) and VC link — disabled when sidecar unavailable, enabled when available
- /login/vc page with full OID4VP flow: QR code rendering, 2s polling, step indicator (scan/verifying/authenticated), 5-minute auto-refresh, error display
- /login/vc/coming-soon static stub for Gaia-X Compliance Wizard with back link
- Three Next.js proxy routes: vc-health (graceful fallback), vc-init (POST), vc-status (GET with Set-Cookie forwarding critical for session establishment)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install react-qr-code, login page VC link with health check** - `6819dbe` (feat)
2. **Task 2: /login/vc page, Coming Soon stub, three proxy routes** - `6114d2f` (feat)

## Files Created/Modified
- `web/src/app/(auth)/login/page.tsx` - Added useSWR vc-health check, "or" divider, VC link (enabled/disabled)
- `web/src/app/(auth)/login/vc/page.tsx` - Full QR code OID4VP flow with polling, step indicator, auto-refresh
- `web/src/app/(auth)/login/vc/coming-soon/page.tsx` - Static Gaia-X Wizard description page
- `web/src/app/api/auth/vc-health/route.ts` - GET proxy with graceful fallback when backend unreachable
- `web/src/app/api/auth/vc-init/route.ts` - POST proxy to initiate OID4VP session
- `web/src/app/api/auth/vc-status/[sessionId]/route.ts` - GET proxy with Set-Cookie forwarding for session establishment
- `web/package.json` - Added react-qr-code v2.0.18

## Decisions Made
- VC link shows as disabled muted text (not a Link) when sidecar unavailable — prevents broken navigation to /login/vc
- Layout.tsx kept as two-column wrapper; VC pages use centered flex layout (min-h-screen) to escape the grid without modifying the layout file
- Verifier only returns pending/authenticated/expired states — step indicator simplified to match real API states (no wallet-connected intermediate)
- Coming Soon page has no interactions per deferred decisions — static description only
- proxy.ts unchanged: AUTH_REDIRECT_PATHS `["/login"]` already covers `/login/vc` and `/login/vc/coming-soon` via `startsWith` check

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required for frontend components. Walt.id sidecar configuration was handled in Plan 01.

## Next Phase Readiness
- VC auth frontend is complete and ready for end-to-end testing with live Walt.id sidecar
- Phase 09 (GXDCH integration) can reference /login/vc/coming-soon as the entry point for the Gaia-X wizard
- Real integration testing requires KEASY_API_URL pointing to a running instance with Walt.id sidecar enabled

---
*Phase: 08-walt-id-integration-vc-auth-path*
*Completed: 2026-02-27*
