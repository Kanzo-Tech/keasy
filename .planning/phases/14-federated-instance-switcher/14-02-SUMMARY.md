---
phase: 14-federated-instance-switcher
plan: "02"
subsystem: ui
tags: [swr, shadcn, dropdown-menu, sidebar, federated, nextjs, oidc]

requires:
  - phase: 14-01
    provides: GET /api/auth/workspaces proxy route returning workspaces array and current_client_id

provides:
  - "Sidebar instance switcher DropdownMenu in SidebarHeader for multi-dataspace users"
  - "Static org name display for single-dataspace users (unchanged behavior)"
  - "SWR global cache clear via mutate(() => true) before cross-instance navigation"
  - "Error toast via sonner on switch failure"
  - "Loader2 loading state during switch transition"

affects: []

tech-stack:
  added: []
  patterns:
    - "useSWR('workspaces') alongside useSWR('auth-me') in AppSidebar for workspace context"
    - "useEffect + switchTarget state pattern for window.location.assign — react-hooks/immutability lint compliance"
    - "clientIdToColor hash function shared between sidebar and workspace picker for consistent visual identity"
    - "Conditional SidebarHeader: switching state > isMultiInstance dropdown > single static display"

key-files:
  created: []
  modified:
    - web/src/components/app-sidebar.tsx

key-decisions:
  - "useEffect + setSwitchTarget pattern instead of direct window.location.href — required for react-hooks/immutability lint compliance (same pattern as workspaces/page.tsx)"
  - "clientIdToColor placed as module-level function outside component — matches workspaces picker page for consistent coloring with zero coordination"
  - "Clicking active workspace is a no-op (if ws.client_id !== currentClientId guard) — prevents unnecessary SWR cache clear and redirect"
  - "try/catch wraps setSwitchTarget (not mutate) — SWR cache clear is already awaited before the try block to ensure cache is cleared regardless"

patterns-established:
  - "Sidebar workspace switcher: useEffect + switchTarget + mutate(() => true) is the canonical cross-instance navigation pattern"

requirements-completed: [FED-03, FED-04, FED-05]

duration: 3min
completed: "2026-02-27"
---

# Phase 14 Plan 02: Federated Instance Switcher — Sidebar Instance Switcher Summary

**Sidebar DropdownMenu switcher in SidebarHeader with SWR cache invalidation and sonner error toast for cross-instance navigation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T22:20:00Z
- **Completed:** 2026-02-27T22:23:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Extended `AppSidebar` to fetch workspaces from `/api/auth/workspaces` via `useSWR("workspaces")` alongside the existing `useSWR("auth-me")` call
- Multi-dataspace users see a `DropdownMenu` in `SidebarHeader` with colored initial circle, workspace name, role label, `ChevronsUpDown` icon, and a dropdown list with color dots, workspace names, URLs, and a `Check` icon on the active workspace
- Single-dataspace users see the unchanged static display (`GalleryVerticalEnd` icon + org name + role)
- Switch flow: `mutate(() => true, undefined, { revalidate: false })` clears all SWR cache, then `useEffect` triggers `window.location.assign` to `${ws.url}/api/auth/oidc-start`
- Loading state replaces entire SidebarHeader with `Loader2` spinner + "Switching to {name}..." during transition
- Error handling: `toast.error(...)` from sonner shown on failure, `switching` state cleared to restore UI

## Task Commits

Each task was committed atomically:

1. **Task 1: Add instance switcher to sidebar header** - `d2910d8` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `web/src/components/app-sidebar.tsx` - Added workspace switcher DropdownMenu, useSWR("workspaces") fetch, clientIdToColor helper, switching state management, useEffect navigation pattern, and error toast handling

## Decisions Made
- Used `useEffect + switchTarget` pattern (not direct `window.location.href`) — carries forward the lint-compliance pattern established in Plan 14-01 workspaces picker to ensure ESLint passes cleanly
- `clientIdToColor` placed as module-level function outside the component — identical implementation to `workspaces/page.tsx`, gives consistent colors with no coordination mechanism needed
- The `try/catch` block wraps `setSwitchTarget` rather than the entire handler — `mutate()` is awaited before the try so the SWR cache is guaranteed cleared even if state setting somehow throws

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Applied useEffect + switchTarget pattern instead of direct window.location.href assignment**
- **Found during:** Task 1 (sidebar instance switcher)
- **Issue:** The plan specified `window.location.href = ...` directly inside the async handler, but Plan 14-01 established that this triggers `react-hooks/immutability` ESLint errors in this Next.js project configuration
- **Fix:** Used `useEffect` watching `switchTarget` state, calling `window.location.assign(switchTarget)` — identical runtime behavior, lint-compliant. Same pattern as `workspaces/page.tsx`
- **Files modified:** `web/src/components/app-sidebar.tsx`
- **Verification:** `npx eslint src/components/app-sidebar.tsx` exits clean (0)
- **Committed in:** `d2910d8` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary for lint compliance. Identical runtime behavior — useEffect fires after SWR cache clear completes. No scope creep.

## Issues Encountered
- `npx next lint` command fails with "Invalid project directory provided, no such directory: .../web/lint" — known issue from Plan 14-01. Used `npx eslint src/components/app-sidebar.tsx` directly instead. Pre-existing error in `ui/sidebar.tsx:611` is out of scope.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 14 is complete — both backend workspaces endpoint (14-01) and sidebar instance switcher (14-02) are implemented
- Full federated instance switcher is operational: post-login workspace picker for multi-dataspace users + always-available sidebar dropdown
- No blockers for Phase 15 (final phase)

---
*Phase: 14-federated-instance-switcher*
*Completed: 2026-02-27*

## Self-Check: PASSED
- `web/src/components/app-sidebar.tsx` exists on disk
- Task commit `d2910d8` verified in git log
- `14-02-SUMMARY.md` created and verified
