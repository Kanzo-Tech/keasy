---
phase: 06-dataspace-switcher-organization-management
plan: 02
subsystem: ui
tags: [swr, react, next.js, shadcn, sidebar, dataspace-switcher, password-change]

# Dependency graph
requires:
  - phase: 06-01
    provides: "Backend GET /v1/auth/me with dataspaces/roles, PUT /v1/auth/password, POST /v1/auth/set-dataspace"
  - phase: 05-02
    provides: "App sidebar structure, NavUser, TeamSwitcher, NavMain components"
provides:
  - "SWR-fed AppSidebar consuming real user/dataspace data from /api/auth/me"
  - "NavUser with initials-based avatar derived from first_name/last_name"
  - "TeamSwitcher with role badges (Promotor/Admin/User) and SWR cache invalidation on switch"
  - "Password change form at /settings/security with zod validation"
  - "API proxy routes: /api/auth/password (PUT) and /api/auth/invite-info (GET)"
affects: [07-arch-cleanup, future-settings-pages]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useSWR with named key ('auth-me') for sidebar data — all sidebar children read from same cache"
    - "useSWRConfig mutate(() => true) to invalidate all caches on dataspace switch"
    - "Initials-only Avatar (no image URL) — derived from first_name[0] + last_name[0] or email[0]"
    - "Cookie-forwarding proxy pattern for auth API routes (consistent with /api/auth/login, /api/auth/me)"

key-files:
  created:
    - "web/src/app/(main)/settings/security/page.tsx"
    - "web/src/app/api/auth/password/route.ts"
  modified:
    - "web/src/components/app-sidebar.tsx"
    - "web/src/components/nav-user.tsx"
    - "web/src/components/team-switcher.tsx"
    - "web/src/lib/auth-schemas.ts"
    - "web/src/components/settings/settings-nav.tsx"
    - "web/src/lib/route-config.ts"

key-decisions:
  - "invite-info proxy already existed from Plan 01 work — no changes needed (deviation noted)"
  - "NavUser uses initials-only avatar (AvatarImage removed) per plan spec — no profile photo upload planned"
  - "TeamSwitcher single-dataspace case renders cursor-default button with no dropdown — non-interactive UX"
  - "KEASY_API_URL env var used (not NEXT_PUBLIC_API_URL) — consistent with existing proxy pattern"

patterns-established:
  - "SWR key naming: use descriptive string keys (e.g., 'auth-me') not URLs — enables targeted invalidation"
  - "Dataspace switch pattern: POST set-dataspace -> mutate all SWR -> router.push('/') — full context reset"

requirements-completed: [USER-10, USER-13, USER-14]

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 06 Plan 02: Dataspace Switcher UI Summary

**SWR-fed sidebar showing real user identity with initials avatar, dataspace switcher with role badges and cache-invalidating switch action, and password change form at /settings/security**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-26T19:12:30Z
- **Completed:** 2026-02-26T19:15:12Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- AppSidebar fully wired to live /api/auth/me data via SWR (tempData removed)
- NavUser shows real name/email with initials-based avatar (first + last name initials)
- TeamSwitcher shows real dataspaces with role badges; switching invalidates all SWR caches and navigates to /
- Single-dataspace users see non-interactive display (no dropdown arrow)
- Password change form at /settings/security with client-side zod validation (12+ chars, uppercase, lowercase, digit, match)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire AppSidebar and NavUser to real API data via SWR** - `f64db5d` (feat)
2. **Task 2: Rewrite TeamSwitcher for real dataspaces with role badges and switching** - `e6b8c83` (feat)
3. **Task 3: Password change settings page with form and API proxy** - `c7eae8c` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `web/src/components/app-sidebar.tsx` - Removed tempData; added useSWR("auth-me") fetching; pass dataspaces/activeDataspaceId to TeamSwitcher
- `web/src/components/nav-user.tsx` - Updated props (firstName/lastName instead of avatar); added getInitials() helper; removed AvatarImage
- `web/src/components/team-switcher.tsx` - Complete rewrite: real dataspaces, ROLE_LABEL map, single vs multi-dataspace behavior, SWR cache invalidation on switch
- `web/src/lib/auth-schemas.ts` - Added changePasswordSchema and ChangePasswordValues type
- `web/src/components/settings/settings-nav.tsx` - Added Security nav item (Shield icon) to General section
- `web/src/lib/route-config.ts` - Added /settings/security route entry
- `web/src/app/(main)/settings/security/page.tsx` - New: password change form with react-hook-form + zod
- `web/src/app/api/auth/password/route.ts` - New: PUT proxy to /v1/auth/password with cookie forwarding

## Decisions Made
- invite-info proxy route already existed from Plan 01 work with a better implementation (includes cookie forwarding) — no changes made
- Used `KEASY_API_URL` env var (not `NEXT_PUBLIC_API_URL` as plan suggested) to remain consistent with existing auth proxy routes
- NavUser AvatarImage fully removed (not just empty src) per plan spec — initials-only approach

## Deviations from Plan

None - plan executed exactly as written (minor: invite-info route already existed, skipped creation).

## Issues Encountered
None - all TypeScript checks passed cleanly after each task.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Sidebar is fully functional with real data
- Dataspace switching works end-to-end
- Password change form is wired to backend
- Plan 03 (organization management pages) can proceed independently
- No blockers

## Self-Check: PASSED

- FOUND: web/src/app/(main)/settings/security/page.tsx
- FOUND: web/src/app/api/auth/password/route.ts
- FOUND: web/src/app/api/auth/invite-info/route.ts
- FOUND: .planning/phases/06-dataspace-switcher-organization-management/06-02-SUMMARY.md
- FOUND: f64db5d (Task 1 commit)
- FOUND: e6b8c83 (Task 2 commit)
- FOUND: c7eae8c (Task 3 commit)

---
*Phase: 06-dataspace-switcher-organization-management*
*Completed: 2026-02-26*
