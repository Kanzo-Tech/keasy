---
phase: 06-dataspace-switcher-organization-management
plan: "01"
subsystem: backend-api
tags: [email, org-management, invite, rbac, auth, dal]
dependency_graph:
  requires: [05-01, 04-02]
  provides: [org-invite-api, org-user-crud-api, password-change-api, invite-info-api, dataspace-role-in-me]
  affects: [server/src/auth/routes.rs, server/src/routes/admin.rs, server/src/routes/org.rs, server/src/email/]
tech_stack:
  added: [lettre=0.11 (SMTP email delivery), rand=0.9 (temp password generation)]
  patterns: [fire-and-forget tokio::spawn for email, dev fallback tracing::warn for SMTP]
key_files:
  created:
    - server/src/email/mod.rs
    - server/src/email/templates.rs
    - server/src/routes/org.rs
  modified:
    - server/Cargo.toml
    - server/src/config.rs
    - server/src/lib.rs
    - server/src/main.rs
    - server/src/auth/routes.rs
    - server/src/auth/errors.rs
    - server/src/db/users.rs
    - server/src/db/dataspaces.rs
    - server/src/routes/admin.rs
    - server/src/routes/mod.rs
    - docker-compose.yml
    - server/tests/auth_smoke.rs
    - server/tests/tenant_isolation.rs
decisions:
  - "EmailService dev fallback: tracing::warn logs invite URL when SMTP not configured — no email server needed for development"
  - "fire-and-forget email via tokio::spawn: HTTP response returns immediately; email errors are logged but don't fail the request"
  - "AuthError::ValidationFailed variant added for password change validation (400) — distinct from RegistrationFailed"
  - "temp password format 'Kx{16-char-alphanumeric}1a' guarantees complexity constraints without validate_password call"
  - "create_dataspace now auto-assigns promotor org to new dataspace — satisfies must_haves truth about POST /v1/admin/dataspaces"
metrics:
  duration: "~6 min"
  completed: "2026-02-26"
  tasks: 2
  files_modified: 13
  files_created: 3
---

# Phase 06 Plan 01: Backend API — Org Invite, User CRUD, Email Service Summary

**One-liner:** Email service with SMTP/dev-fallback, org invite flow, org admin user CRUD (create/list/role/remove), password change, invite-info, and role-per-dataspace in GET /v1/auth/me.

## What Was Built

### EmailService (server/src/email/)

- `EmailService::from_env()` reads `KEASY_SMTP_HOST`, `KEASY_SMTP_USER`, `KEASY_SMTP_PASS`, `KEASY_SMTP_PORT` (default 587), `KEASY_SMTP_FROM`
- `send_invite_email()`: STARTTLS SMTP delivery if configured; otherwise `tracing::warn!` logs invite URL for dev use
- `templates::invite_email_body()`: plain-text invite email body with 7-day expiry message

### New/Extended API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /v1/auth/me | session | Extended to include `role` per dataspace entry + `membership_role` |
| PUT | /v1/auth/password | session | Change password — validates current first |
| GET | /v1/auth/invite-info | public | Returns pre-filled email for valid unused token |
| POST | /v1/admin/organizations | promotor | Create org + invite token + send email |
| GET | /v1/admin/dataspace/organizations | promotor | List orgs in active dataspace |
| GET | /v1/org/users | org_admin | List users in caller's org |
| POST | /v1/org/users | org_admin | Create user with temp password |
| PUT | /v1/org/users/{id} | org_admin | Change user role |
| DELETE | /v1/org/users/{id} | org_admin | Remove user from org |

### DAL Extensions

**server/src/db/users.rs:**
- `UserWithRole` struct (id, email, first_name, last_name, status, created_at, role)
- `update_user_password(user_id, password_hash)` — used by PUT /v1/auth/password
- `list_users_in_org(org_id)` — JOIN with user_org_memberships
- `update_user_role_in_org(user_id, org_id, new_role)` — UPDATE user_org_memberships
- `remove_user_from_org(user_id, org_id)` — DELETE user_org_memberships

**server/src/db/dataspaces.rs:**
- `OrgInDataspace` struct (id, name, role, created_at)
- `list_orgs_in_dataspace(dataspace_id)` — JOIN organizations with org_dataspace_memberships

### AppState Extensions

- `email_service: EmailService` — for invite email delivery
- `base_url: String` — read from `KEASY_BASE_URL` (default `http://localhost:3000`), used to construct invite URLs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed &str vs String type mismatch in change_password**
- **Found during:** Task 1 cargo check
- **Issue:** `password::validate_password()` returns `Result<(), &str>` but `AuthError::ValidationFailed` expects `String`
- **Fix:** `.map_err(|e| AuthError::ValidationFailed(e.to_string()))`
- **Files modified:** server/src/auth/routes.rs
- **Commit:** 03da1b1

**2. [Rule 3 - Blocking] Integration tests missing new AppState fields**
- **Found during:** Task 2 `cargo test`
- **Issue:** `auth_smoke.rs` and `tenant_isolation.rs` construct AppState directly — new `email_service` and `base_url` fields caused compile error
- **Fix:** Added `email_service: EmailService::from_env()` and `base_url: "http://localhost:3000".to_string()` to both test AppState initializers
- **Files modified:** server/tests/auth_smoke.rs, server/tests/tenant_isolation.rs
- **Commit:** 7b68f12

## Self-Check: PASSED

- FOUND: server/src/email/mod.rs
- FOUND: server/src/email/templates.rs
- FOUND: server/src/routes/org.rs
- FOUND commit 03da1b1: feat(06-01): email service, DAL extensions, get_me roles, password change and invite-info endpoints
- FOUND commit 7b68f12: feat(06-01): org creation with invite flow, org admin CRUD endpoints, auto-dataspace membership
- All 12 tests pass (cargo test: 1+0+2+9 = 12 tests across test suites)
- cargo check: PASSED
- cargo clippy -- -D warnings: PASSED (no warnings)
