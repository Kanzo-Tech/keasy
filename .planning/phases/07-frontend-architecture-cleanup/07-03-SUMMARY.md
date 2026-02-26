---
phase: 07-frontend-architecture-cleanup
plan: "03"
subsystem: frontend
tags: [tanstack-table, shadcn, data-table, swr, api, org-users, organizations, types]
dependency_graph:
  requires:
    - "07-01 (DataTable component, EmptyState with CTA, Checkbox primitive)"
  provides:
    - "OrgUser and OrgEntry interfaces in lib/types.ts"
    - "fetchOrgUsers, updateOrgUserRole, removeOrgUser, fetchDataspaceOrganizations, addOrganization API functions in lib/api.ts"
    - "useOrgUsers SWR hook with handleRoleChange and handleRemoveUser mutations"
    - "getOrgUserColumns factory (org-user-columns.tsx) — select, name+icon, email, role select, status badge, kebab remove"
    - "organizationColumns (organization-columns.tsx) — name+icon, role badge, created date"
    - "org/users/page.tsx migrated to DataTable with zero raw fetch()"
    - "admin/organizations/page.tsx migrated to DataTable with zero raw fetch()"
  affects:
    - "Completes ARCH-01 table migration for all five entity types"
    - "Satisfies ARCH-02: zero raw fetch() in client page components"
tech_stack:
  added: []
  patterns:
    - "SWR hook factory pattern (useOrgUsers encapsulates fetch + mutations + toasts)"
    - "Column factory pattern (getOrgUserColumns with callback options)"
    - "Static column export (organizationColumns — no row actions, no factory needed)"
    - "EmptyState with custom action slot for Dialog trigger"
key_files:
  created:
    - web/src/components/columns/org-user-columns.tsx
    - web/src/components/columns/organization-columns.tsx
    - web/src/hooks/use-org-users.ts
  modified:
    - web/src/lib/types.ts
    - web/src/lib/api.ts
    - web/src/app/(main)/org/users/page.tsx
    - web/src/app/(main)/admin/organizations/page.tsx
decisions:
  - "OrgUser interface named OrgUser (not UserEntry) for domain clarity — represents a user within an organization context"
  - "Organization empty state uses action ReactNode prop (Dialog trigger) instead of actionHref — Add Organization is a dialog, not a navigation"
  - "useOrgUsers hook directly calls mutate() (no optimistic update) — simplest correct approach, matches other hooks"
  - "getOrgUserColumns factory pattern (not static export) because callbacks are needed for role change and remove"
metrics:
  duration: "~2 min"
  completed_date: "2026-02-27"
  tasks_completed: 2
  files_modified: 7
---

# Phase 7 Plan 03: Admin Table Migrations (Org Users and Organizations) Summary

**One-liner:** Org users and organizations admin pages migrated to DataTable with SWR hook, lib/api.ts functions, and OrgUser/OrgEntry types in lib/types.ts — zero raw fetch() in client components.

## What Was Built

### Task 1: Types, API functions, and SWR hook (commit: 9f7eea9)

**lib/types.ts additions:**
- `OrgUser` interface: `id`, `email`, `first_name`, `last_name`, `status`, `created_at`, `role`
- `OrgEntry` interface: `id`, `name`, `role`, `created_at`

**lib/api.ts additions (5 functions):**
- `fetchOrgUsers()` — GET /api/org/users → OrgUser[]
- `updateOrgUserRole(userId, role)` — PUT /api/org/users/[id] → OrgUser
- `removeOrgUser(userId)` — DELETE /api/org/users/[id] → void
- `fetchDataspaceOrganizations()` — GET /api/admin/dataspace-organizations → OrgEntry[]
- `addOrganization(data)` — POST /api/admin/organizations → OrgEntry

**useOrgUsers hook** (`web/src/hooks/use-org-users.ts`):
- SWR key: `"org-users"`, fetcher: `fetchOrgUsers`
- `handleRoleChange(userId, newRole)` — calls `updateOrgUserRole`, shows toast, calls `mutate()`
- `handleRemoveUser(userId, userName)` — calls `removeOrgUser`, shows toast, calls `mutate()`
- Returns: `{ users, isLoading, error, mutate, handleRoleChange, handleRemoveUser }`

### Task 2: Column definitions and page rewrites (commit: 68247d3)

**org-user-columns.tsx** — `getOrgUserColumns(options)` factory:
1. Select column with `Checkbox` (all-rows + per-row)
2. Name column (sortable) — `accessorFn` joins `first_name + last_name || email`; cell has `UserCircle` icon
3. Email column (sortable)
4. Role column — inline `<Select>` dropdown (Admin/User) calling `options.onRoleChange`; `stopPropagation` on trigger
5. Status column — `<Badge>` with variant map (active=default, inactive=secondary)
6. Actions column — kebab `DropdownMenu` with destructive "Remove" item calling `options.onRemove`

**organization-columns.tsx** — `organizationColumns` static const:
1. Name column (sortable) — `Building2` icon + name
2. Role column — `<Badge variant="outline">` with `ROLE_LABEL` map (promotor/participant)
3. Created column (sortable) — `toLocaleDateString()` with muted foreground

**org/users/page.tsx rewrite:**
- Uses `useOrgUsers()` hook — no raw fetch, no inline state for remove
- `useMemo` for column definitions with `handleRoleChange`/`handleRemoveUser` callbacks
- `<DataTable searchKey="email" searchPlaceholder="Search users..." />`
- `<EmptyState icon={UserCircle} actionHref="/org/users/new" actionLabel="Add User" />` when no users

**admin/organizations/page.tsx rewrite:**
- `useSWR("dataspace-orgs", fetchDataspaceOrganizations)` — no inline fetcher
- `addOrganization(values)` replaces raw POST fetch in `onAddOrg`
- `<DataTable columns={organizationColumns} searchKey="name" searchPlaceholder="Search organizations..." />`
- `<EmptyState icon={Building2} action={<DialogTrigger>} />` for empty state with dialog trigger as action slot
- Dialog form kept intact (react-hook-form + zod, same UX)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `web/src/lib/types.ts`: OrgUser and OrgEntry interfaces present
- `web/src/lib/api.ts`: fetchOrgUsers, updateOrgUserRole, removeOrgUser, fetchDataspaceOrganizations, addOrganization exported
- `web/src/hooks/use-org-users.ts`: created, exports useOrgUsers
- `web/src/components/columns/org-user-columns.tsx`: created, exports getOrgUserColumns
- `web/src/components/columns/organization-columns.tsx`: created, exports organizationColumns
- `web/src/app/(main)/org/users/page.tsx`: migrated, zero raw fetch()
- `web/src/app/(main)/admin/organizations/page.tsx`: migrated, zero raw fetch()
- `npx tsc --noEmit`: zero errors
- `npm run build`: succeeded
- Commits: 9f7eea9 (task 1), 68247d3 (task 2)
