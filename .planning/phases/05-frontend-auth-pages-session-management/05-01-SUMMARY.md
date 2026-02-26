---
phase: 05-frontend-auth-pages-session-management
plan: 01
subsystem: web/auth-infrastructure
tags: [auth, cookies, proxy, swr, react-hook-form, next-js, session]
dependency_graph:
  requires: []
  provides:
    - "Cookie and Set-Cookie forwarding for all API proxied requests"
    - "Next.js 16 route guard redirecting unauthenticated users to /login"
    - "SWR global 401 handler redirecting expired sessions to /login?reason=session_expired"
    - "Auth API routes: login, register, logout, me, set-dataspace"
  affects:
    - "All subsequent frontend auth UI (Plan 02, 03)"
    - "All SWR data fetching hooks that hit /api/* routes"
tech_stack:
  added:
    - react-hook-form@7.71.2
    - "@hookform/resolvers@5.2.2"
    - zod@4.3.6
  patterns:
    - "Next.js 16 middleware via proxy.ts export (not middleware.ts)"
    - "Cookie forwarding pattern in createHandler + individual auth route handlers"
    - "getSetCookie() API for multi-value Set-Cookie header forwarding"
    - "useRef deduplification of SWR 401 redirects"
key_files:
  created:
    - web/src/proxy.ts
    - web/src/app/api/auth/login/route.ts
    - web/src/app/api/auth/register/route.ts
    - web/src/app/api/auth/logout/route.ts
    - web/src/app/api/auth/me/route.ts
    - web/src/app/api/auth/set-dataspace/route.ts
  modified:
    - web/src/lib/api-proxy.ts
    - web/src/components/swr-provider.tsx
    - web/package.json
decisions:
  - "Auth API routes are NOT using createHandler from api-proxy.ts — they are standalone one-off proxies per plan spec"
  - "proxy.ts excludes /api/ from matcher so auth routes are never blocked by the route guard"
  - "SWR 401 deduplication uses useRef(false) — first redirect wins, parallel hooks ignored"
  - "X-Api-Key header removed from api-proxy.ts — backend never used api_key_auth (was dead code)"
metrics:
  duration: "~2 min"
  completed: "2026-02-26"
  tasks_completed: 2
  files_changed: 9
---

# Phase 05 Plan 01: Auth Infrastructure Summary

**One-liner:** Cookie-forwarding proxy with Next.js 16 route guard, SWR 401 session handler, and five auth API routes using keasy.sid session cookie.

## What Was Built

The auth infrastructure layer that all Phase 05 auth UI depends on:

1. **API proxy cookie forwarding** (`web/src/lib/api-proxy.ts`): Removed dead `X-Api-Key` header; added `Cookie` header forwarding so session cookies reach the backend on every proxied request; added `Set-Cookie` forwarding using `getSetCookie()` so login/register responses set `keasy.sid` on the browser.

2. **Next.js 16 route guard** (`web/src/proxy.ts`): Exports `proxy` function (not `middleware` — Next.js 16 convention) and `config.matcher`. Unauthenticated users hitting any non-public route are redirected to `/login`. Authenticated users visiting `/login` or `/register` are redirected to `/`. The `/api/` path is excluded from the matcher — the guard is a UX gate, not a security gate.

3. **Five auth API route handlers** under `web/src/app/api/auth/`: Each handler is a standalone proxy (not using `createHandler`) that forwards `Cookie` from browser to backend and `Set-Cookie` back. Routes: `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/set-dataspace`.

4. **SWR global 401 handler** (`web/src/components/swr-provider.tsx`): Added `onError` callback that detects `auth/session_required` and `auth/session_expired` error codes and redirects to `/login?reason=session_expired`. A `useRef` flag prevents duplicate redirects from parallel SWR hooks firing simultaneously.

5. **Dependencies installed**: `react-hook-form`, `@hookform/resolvers`, and `zod` added to `web/package.json` as explicit dependencies for use in Plan 02 auth forms.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install react-hook-form, fix API proxy, create route guard | 29c6c3c | web/package.json, web/src/lib/api-proxy.ts, web/src/proxy.ts |
| 2 | Create auth API routes and update SWR provider | 20f8c63 | 5 route files, web/src/components/swr-provider.tsx |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `web/src/proxy.ts` exists: FOUND
- `web/src/lib/api-proxy.ts` updated: FOUND (Cookie forwarding, no X-Api-Key)
- `web/src/app/api/auth/login/route.ts`: FOUND
- `web/src/app/api/auth/register/route.ts`: FOUND
- `web/src/app/api/auth/logout/route.ts`: FOUND
- `web/src/app/api/auth/me/route.ts`: FOUND
- `web/src/app/api/auth/set-dataspace/route.ts`: FOUND
- `web/src/components/swr-provider.tsx` has session_expired redirect: FOUND
- `web/package.json` has react-hook-form, @hookform/resolvers, zod: FOUND
- TypeScript (`npx tsc --noEmit`): PASS
- Commits 29c6c3c and 20f8c63: FOUND
