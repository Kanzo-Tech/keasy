---
phase: 05-frontend-auth-pages-session-management
plan: 02
subsystem: web/auth-pages
tags: [auth, react-hook-form, zod, next-js, split-screen, login, register]
dependency_graph:
  requires:
    - "05-01: auth infrastructure (auth API routes, cookie forwarding, route guard)"
  provides:
    - "Login page at /login with email/password form, session expired banner, post-login dataspace auto-selection"
    - "Register page at /register with name/email/password/invite_token, URL-based token pre-fill"
    - "Split-screen auth layout — branding panel left (hidden mobile), form right"
    - "Zod schemas (loginSchema, registerSchema) + inferred TypeScript types"
  affects:
    - "All authenticated users entering via /login or /register"
    - "Plan 05-03 logout (uses same auth layout)"
tech_stack:
  added: []
  patterns:
    - "react-hook-form useForm with zodResolver, mode: onBlur, reValidateMode: onChange"
    - "Suspense boundary wrapping useSearchParams consumer (required by Next.js App Router)"
    - "register() spread onto Input (not Controller) — Input is forwardRef standard input"
    - "Post-auth: GET /api/auth/me, auto-set dataspace if exactly one, then router.push('/')"
    - "Split-screen: lg:grid-cols-2, left panel hidden below lg breakpoint"
key_files:
  created:
    - web/src/lib/auth-schemas.ts
    - web/src/app/(auth)/login/page.tsx
    - web/src/app/(auth)/register/page.tsx
  modified:
    - web/src/app/(auth)/layout.tsx
decisions:
  - "reValidateMode not revalidateMode — react-hook-form uses camelCase capital V"
  - "register() spread used instead of Controller — Input is a standard forwardRef input, not a controlled component"
  - "Post-auth auto-dataspace selection is non-fatal (try/catch) — proceed to dashboard even if set-dataspace fails"
  - "Register page sends only email, password, invite_token to backend — name field is UX-only, backend has no name field in Phase 5"
  - "invite_token field is read-only (disabled) when pre-filled from ?token= URL param"
metrics:
  duration: "~2 min"
  completed: "2026-02-26"
  tasks_completed: 2
  files_changed: 4
---

# Phase 05 Plan 02: Login and Register Pages Summary

**One-liner:** Split-screen auth pages with react-hook-form + zod validation, post-login dataspace auto-selection, and Suspense-wrapped useSearchParams for session expiry banner.

## What Was Built

1. **Auth validation schemas** (`web/src/lib/auth-schemas.ts`): `loginSchema` (email + password) and `registerSchema` (name + email + password + invite_token) using zod 4.3.6. Exported inferred types `LoginValues` and `RegisterValues`.

2. **Split-screen auth layout** (`web/src/app/(auth)/layout.tsx`): Replaced the old centered card design with a two-column grid. Left panel: dark slate gradient with Keasy logo (Database icon), tagline text, hidden on mobile (`hidden lg:flex`). Right panel: centered form area constrained to `max-w-sm`.

3. **Login page** (`web/src/app/(auth)/login/page.tsx`): Client component with `useForm` + `zodResolver`, `mode: "onBlur"`, `reValidateMode: "onChange"`. Session expiry banner shows when `?reason=session_expired` is in URL. On successful login: calls `GET /api/auth/me`, auto-calls `POST /api/auth/set-dataspace` if user has exactly one dataspace, then redirects to `/`. Server errors show "Invalid email or password" (generic). All fields disabled during submission with Loader2 spinner on submit button.

4. **Register page** (`web/src/app/(auth)/register/page.tsx`): Same form patterns as login. Invite token pre-fills from `?token=` URL param and becomes read-only when set. Sends only email, password, invite_token to backend (name field is UX-only). Post-register follows same auto-dataspace + redirect flow as login. No "Forgot password?" link per spec.

Both pages wrap their form content in `<Suspense fallback={null}>` because they use `useSearchParams()` (required by Next.js App Router).

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Auth schemas, split-screen layout, login page | d3f47cb | web/src/lib/auth-schemas.ts, web/src/app/(auth)/layout.tsx, web/src/app/(auth)/login/page.tsx |
| 2 | Build register page | e3186dc | web/src/app/(auth)/register/page.tsx |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed revalidateMode typo (reValidateMode)**
- **Found during:** Task 1 TypeScript compile check
- **Issue:** Plan spec used `revalidateMode` but react-hook-form uses `reValidateMode` (capital V) — TypeScript error TS2561
- **Fix:** Corrected to `reValidateMode: "onChange"` in login page (and used correct form in register page from the start)
- **Files modified:** web/src/app/(auth)/login/page.tsx
- **Commit:** d3f47cb (corrected before commit)

## Self-Check: PASSED

- `web/src/lib/auth-schemas.ts` exports loginSchema, registerSchema, LoginValues, RegisterValues: FOUND
- `web/src/app/(auth)/layout.tsx` split-screen layout with lg:grid-cols-2: FOUND
- `web/src/app/(auth)/login/page.tsx` with Suspense boundary, session expiry banner, post-login auto-dataspace: FOUND
- `web/src/app/(auth)/register/page.tsx` with invite token from URL, Suspense boundary: FOUND
- Commit d3f47cb: FOUND
- Commit e3186dc: FOUND
- TypeScript (`npx tsc --noEmit`): PASS
