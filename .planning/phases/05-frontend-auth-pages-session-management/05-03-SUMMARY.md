---
phase: 05-frontend-auth-pages-session-management
plan: 03
subsystem: web/auth-ui
tags: [auth, logout, alertdialog, shadcn, session, sidebar]
dependency_graph:
  requires:
    - "05-01: POST /api/auth/logout route"
  provides:
    - "NavUser logout flow with AlertDialog confirmation"
    - "Intentional logout redirects to /login (no ?reason= param)"
  affects:
    - "User session termination UX in sidebar"
tech_stack:
  added: []
  patterns:
    - "AlertDialog nested in DropdownMenu with onSelect={(e) => e.preventDefault()} to prevent dropdown close on dialog open"
    - "handleLogout: fire-and-forget fetch with catch, then router.push to /login"
key_files:
  created: []
  modified:
    - web/src/components/nav-user.tsx
decisions:
  - "onSelect={(e) => e.preventDefault()} on DropdownMenuItem prevents Radix from closing the dropdown when AlertDialog trigger fires — required pattern for nested dialog-in-menu"
  - "handleLogout swallows fetch errors and always redirects — logout should never get stuck even if server is unreachable"
  - "router.push('/login') used without ?reason= param — intentional logout must NOT show session expired message (only forced redirects from SWR 401 handler use ?reason=session_expired)"
metrics:
  duration: "~1 min"
  completed: "2026-02-26"
  tasks_completed: 1
  files_changed: 1
---

# Phase 05 Plan 03: NavUser Logout Confirmation Summary

**One-liner:** NavUser sidebar logout wrapped in shadcn AlertDialog confirmation with fire-and-forget POST /api/auth/logout and clean /login redirect.

## What Was Built

Updated `web/src/components/nav-user.tsx` to replace the inert logout `DropdownMenuItem` with a fully functional logout confirmation flow:

1. **AlertDialog confirmation** — Clicking "Log out" in the sidebar dropdown opens an AlertDialog ("Are you sure you want to log out?") with Cancel and "Log out" actions. Cancel dismisses with no side effects.

2. **handleLogout function** — Calls `POST /api/auth/logout` to destroy the server-side session cookie, then redirects to `/login` via `useRouter`. Errors from the fetch are swallowed (logout is best-effort; redirect always happens).

3. **Loading state** — The confirm button shows "Logging out..." and is disabled while the API call is in flight.

4. **No session expired message** — `router.push("/login")` is used without `?reason=` query param, so the login page does not show the "Session expired" banner that only appears after forced redirects from the SWR 401 handler.

5. **Dropdown close prevention** — `onSelect={(e) => e.preventDefault()}` on the DropdownMenuItem prevents Radix UI from closing the dropdown when the AlertDialog opens — the required pattern for nesting dialogs inside dropdown menus.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add logout AlertDialog confirmation to NavUser | 2c259d7 | web/src/components/nav-user.tsx |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `web/src/components/nav-user.tsx` exists: FOUND
- Imports AlertDialog components: FOUND (lines 13-21)
- `onSelect={(e) => e.preventDefault()}` pattern: FOUND (line 116)
- `handleLogout` calls `/api/auth/logout`: FOUND (line 60)
- `router.push("/login")` with no `?reason=`: FOUND (line 65)
- TypeScript (`npx tsc --noEmit`): PASS
- Commit 2c259d7: FOUND
