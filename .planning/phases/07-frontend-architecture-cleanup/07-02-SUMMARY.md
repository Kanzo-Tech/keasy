---
phase: 07-frontend-architecture-cleanup
plan: "02"
subsystem: frontend
tags: [data-table, tanstack-table, list-views, jobs, connections, cloud-accounts, arch-cleanup]
dependency_graph:
  requires: [07-01]
  provides: [DataTable-job-list, DataTable-connection-list, DataTable-cloud-account-list]
  affects: [web/src/app/(main)/(data), web/src/components/settings]
tech_stack:
  added: []
  patterns: [TanStack Table factory function columns, useMemo column memoization, kebab-menu actions, EmptyState with CTA]
key_files:
  created:
    - web/src/components/columns/job-columns.tsx
    - web/src/components/columns/connection-columns.tsx
    - web/src/components/columns/cloud-account-columns.tsx
  modified:
    - web/src/app/(main)/(data)/jobs/page.tsx
    - web/src/app/(main)/(data)/connections/page.tsx
    - web/src/components/settings/cloud-accounts-tab.tsx
    - web/src/app/(main)/(data)/layout.tsx
  deleted:
    - web/src/components/job-table.tsx
decisions:
  - "Factory function pattern for columns with callbacks (getJobColumns, getConnectionColumns, getCloudAccountColumns) — avoids module-level re-creation while allowing onDelete callbacks and external data (accounts, schema)"
  - "Deleted job-table.tsx entirely (no deprecation comment) — cleaner codebase, no dead code"
  - "EmptyState shown when !jobs?.length (no jobs at all) before DataTable — TanStack Table handles the filtered-to-zero case with its own 'No results' row"
  - "ARCH-03 verified (no code change): Discovery/Catalog are tabs in /jobs/[id]/page.tsx"
  - "ARCH-04 verified (no code change): Job detail is at /jobs/[id]/page.tsx"
metrics:
  duration_seconds: 162
  completed_date: "2026-02-27"
  tasks_completed: 2
  files_created: 3
  files_modified: 4
  files_deleted: 1
---

# Phase 7 Plan 02: DataTable List View Migrations Summary

**One-liner:** Migrated jobs, connections, and cloud accounts list views from raw HTML tables to DataTable + TanStack Table factory-function column definitions with sortable columns, checkbox selection, kebab-menu delete actions, and EmptyState CTAs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create column definitions for jobs, connections, cloud accounts | a7a820b | job-columns.tsx, connection-columns.tsx, cloud-account-columns.tsx |
| 2 | Migrate jobs, connections, cloud accounts list views to DataTable | 288b7b4 | jobs/page.tsx, connections/page.tsx, cloud-accounts-tab.tsx, layout.tsx, (deleted) job-table.tsx |

## What Was Built

### Column Definitions (`web/src/components/columns/`)

Three column definition files using the factory function pattern:

**`job-columns.tsx` — `getJobColumns({ onDelete })`:**
- Select (checkbox, no sort/hide), Name (sortable), Status (JobStatusBadge, filterFn for faceted filtering), Mode (capitalized, muted), Created (sortable, formatDate), Duration (formatJobDuration), Actions (kebab menu — Delete for terminal statuses only: draft/completed/failed/cancelled)

**`connection-columns.tsx` — `getConnectionColumns({ onDelete, accounts, schema })`:**
- Select, Name (sortable), Location (cloud: provider icon + account name; local: `<Badge variant="outline">Local</Badge>`), URL (mono font, muted), Actions (kebab Delete)

**`cloud-account-columns.tsx` — `getCloudAccountColumns({ onDelete, schema })`:**
- Select, Name (sortable), Provider (icon + label resolved from schema), Auth method (human-readable label from schema), Actions (kebab Delete)

### List View Migrations

**Jobs page** (`/jobs`): Replaced `JobTable` + `ScrollArea` with `DataTable` + `getJobColumns`. Page header with "Create job" button. EmptyState with `actionHref="/jobs/new"`. Row click navigates to `/jobs/new?draft=[id]` for drafts, `/jobs/[id]` otherwise.

**Connections page** (`/connections`): Replaced raw `<Table>` + `DeleteButton` with `DataTable` + `getConnectionColumns`. Page header with "Create connection" button. EmptyState with `actionHref="/connections/new"`. Row click navigates to `/connections/[id]`.

**Cloud accounts tab** (`/settings/cloud-accounts`): Replaced raw `<Table>` + `DeleteButton` with `DataTable` + `getCloudAccountColumns`. Existing SettingsPage/SettingsSection wrapper kept. EmptyState upgraded with `actionHref="/settings/cloud-accounts/new"` + `actionLabel`.

**(data) layout**: Added `p-4 gap-4` classes for consistent padding across all data pages (ARCH-05).

### ARCH Requirements Verified

- **ARCH-03**: Discovery/Catalog views are tabs within `/jobs/[id]/page.tsx` — already implemented, no changes needed.
- **ARCH-04**: Job detail is a dedicated page at `/jobs/[id]/page.tsx` — already implemented, no changes needed.
- **ARCH-05**: Create buttons in each list page's own header (not in shared layout) per Pattern 7 recommendation.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

### Files Created
- `web/src/components/columns/job-columns.tsx` — EXISTS
- `web/src/components/columns/connection-columns.tsx` — EXISTS
- `web/src/components/columns/cloud-account-columns.tsx` — EXISTS

### Files Modified
- `web/src/app/(main)/(data)/jobs/page.tsx` — EXISTS
- `web/src/app/(main)/(data)/connections/page.tsx` — EXISTS
- `web/src/components/settings/cloud-accounts-tab.tsx` — EXISTS
- `web/src/app/(main)/(data)/layout.tsx` — EXISTS

### Files Deleted
- `web/src/components/job-table.tsx` — DELETED (confirmed)

### Commits
- a7a820b — EXISTS
- 288b7b4 — EXISTS

### Build
- `npx tsc --noEmit` — PASSED (zero errors)
- `npm run build` — PASSED

## Self-Check: PASSED
