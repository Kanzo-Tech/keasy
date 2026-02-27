---
phase: 13-promotor-participant-route-separation
plan: "02"
subsystem: [ui, routing, api]
tags: [role-split-dashboard, invite-management, api-proxy, settings-nav, rsc]
dependency_graph:
  requires:
    - 13-01 (RSC role-gate layouts, invite backend API, route groups)
  provides:
    - Role-split home dashboard (promotor vs participant content at /)
    - Invite link management UI on Participants page
    - Next.js proxy routes for GET/POST/DELETE /v1/admin/invites
    - Role-filtered settings nav (promotor: Preferences only; participant: Preferences+Wallet+AI+Cloud Accounts)
  affects:
    - web/src/app/(main)/page.tsx
    - web/src/app/(main)/(promotor)/participants/page.tsx
    - web/src/components/settings/settings-nav.tsx
tech_stack:
  added: []
  patterns:
    - RSC home page delegates role-check to getEffectiveRole(), renders typed client component
    - Client component SWR fetch for dashboard data (no prop drilling from RSC)
    - Next.js API proxy pattern (forward Cookie header, stream body, forward status)
    - Dialog + useSWR mutate pattern for create-and-display invite flow
key_files:
  created:
    - web/src/app/(main)/promotor-dashboard.tsx
    - web/src/app/(main)/participant-dashboard.tsx
    - web/src/app/api/admin/invites/route.ts
    - web/src/app/api/admin/invites/[token]/route.ts
  modified:
    - web/src/app/(main)/page.tsx
    - web/src/app/(main)/(promotor)/participants/page.tsx
    - web/src/components/settings/settings-nav.tsx
decisions:
  - page.tsx is a minimal RSC orchestrator — all data fetching and UI in typed client components (PromotorDashboard / ParticipantDashboard)
  - PromotorDashboard reuses admin-orgs SWR key, deriving participant count from existing org list fetch
  - Invite URL falls back to window.location.origin + /invite?token={token} if backend omits invite_url field
  - Settings nav removes Security from both roles per CONTEXT.md spec (Promotor=Preferences only; Participant=Preferences+AI+Cloud Accounts+Wallet)
metrics:
  duration: "3 min"
  completed_date: "2026-02-27"
  tasks_completed: 2
  files_modified: 7
---

# Phase 13 Plan 02: Role-Split Dashboards and Invite Management Summary

**One-liner:** RSC role-split home dashboard with promotor/participant client components, invite link management UI on Participants page, Next.js proxy routes for invite API, and strict role-filtered settings nav.

## What Was Built

### Task 1: Build role-split dashboard page (commit: 49ae296)

**`web/src/app/(main)/page.tsx`** rewritten as a minimal async RSC:
- Calls `getEffectiveRole()` from `@/lib/auth-check`
- Redirects to `/login` if unauthenticated
- Renders `<PromotorDashboard />` for `role === 'promotor'`, `<ParticipantDashboard />` for all other roles

**`web/src/app/(main)/promotor-dashboard.tsx`** (new client component):
- Single SWR fetch to `/api/admin/organizations`, derives participant count (orgs where role !== 'promotor')
- Two `SummaryCard` components: Participants (links to /participants) and Catalog Items (links to /catalog)
- Cards show skeleton while loading, then count + description

**`web/src/app/(main)/participant-dashboard.tsx`** (new client component):
- Extracted from the previous `page.tsx` DashboardPage content with no behavioral changes
- Retains all SWR fetches: jobs, cloud-accounts, connections, gx-compliance-status
- Retains ReadinessCard and StatCard sub-components with identical styling

### Task 2: Invite management, proxy routes, settings nav (commit: c8bd989)

**`web/src/app/api/admin/invites/route.ts`** (new):
- `GET`: proxies to `GET /v1/admin/invites` forwarding Cookie header, streaming body
- `POST`: proxies to `POST /v1/admin/invites` forwarding Cookie + Content-Type + body

**`web/src/app/api/admin/invites/[token]/route.ts`** (new):
- `DELETE`: proxies to `DELETE /v1/admin/invites/{token}`, returns 204 on success

**`web/src/app/(main)/(promotor)/participants/page.tsx`** (extended):
- Added second SWR fetch for invites via `admin-invites` key
- "Invite Organization" button opens a `Dialog` with an org name input
- On submit: POST to `/api/admin/invites`, shows returned invite_url with Copy button
- "Pending Invitations" section below the org table: lists invites with status Badge (pending/used/expired), Created/Expires timestamps, Copy Link + Revoke actions for pending invites
- Uses `toast` from sonner for success/error feedback throughout

**`web/src/components/settings/settings-nav.tsx`** (updated):
- Replaced conditional spread with ternary `sections` array
- Promotor: single "General" group with only "Preferences"
- Participant: "General" group (Preferences + Wallet) + "Integrations" group (Cloud Accounts + AI)
- Removed `Shield` import (Security removed from nav for both roles)

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx next build` passes with all 7 modified/created files
- `/` RSC page renders role-appropriate dashboard for both roles
- `/api/admin/invites` and `/api/admin/invites/[token]` routes confirmed in build output
- Settings nav: promotor shows Preferences only, participant shows Preferences+Wallet+AI+Cloud Accounts
- Invite dialog: create → shows URL with copy button; list → shows status badges; revoke → DELETE proxy

## Self-Check: PASSED

All 7 key files found on disk. Both task commits (49ae296, c8bd989) present in git log.
