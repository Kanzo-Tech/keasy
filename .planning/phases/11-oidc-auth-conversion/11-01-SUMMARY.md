---
phase: 11-oidc-auth-conversion
plan: "01"
subsystem: auth
tags: [oidc, pkce, axum, rust, session, keycloak, sqlite]
dependency_graph:
  requires:
    - 10-03-SUMMARY.md  # Keycloak admin API client
  provides:
    - OIDC RP start/callback endpoints (GET /v1/auth/oidc-start, GET /v1/auth/oidc-callback)
    - OidcState in AppState with JWKS-cached provider metadata
    - DB: upsert_user_by_subject(), get_user_by_subject()
    - DB: subject column migration on users table
    - Updated logout (returns Keycloak end-session URL)
    - Updated get_me (defaults auth_method to "oidc")
  affects:
    - server/src/auth/routes.rs  # logout, get_me changed
    - server/src/lib.rs          # AppState extended
    - server/src/main.rs         # startup OIDC init added
tech_stack:
  added:
    - openidconnect = "4.0" (reqwest feature) — OIDC RP implementation
  patterns:
    - PKCE S256 authorization code flow stored in tower-sessions
    - 15-minute JWKS cache with refresh-on-failure in Arc<RwLock<>>
    - Redirect-based error responses for browser-facing OIDC endpoints
    - Empty password_hash string for OIDC users (no migration needed)
key_files:
  created:
    - server/src/auth/oidc.rs    # OIDC types, client, handlers (380+ lines)
  modified:
    - server/Cargo.toml          # added openidconnect = "4.0"
    - server/src/auth/errors.rs  # OIDC error variants with redirect responses
    - server/src/auth/mod.rs     # added pub mod oidc
    - server/src/lib.rs          # added oidc_state: Option<Arc<OidcState>> to AppState
    - server/src/db/schema.rs    # subject column migration
    - server/src/db/users.rs     # upsert_user_by_subject(), get_user_by_subject()
    - server/src/auth/routes.rs  # logout returns end_session_url, get_me defaults to "oidc"
    - server/src/routes/mod.rs   # OIDC routes wired as public auth routes
    - server/src/main.rs         # OIDC client built at startup, oidc_state in AppState
decisions:
  - "KeyasyClient type alias requires two type aliases (KeyasyClientDiscovered + KeyasyClient) due to openidconnect 4.x endpoint state type system: from_provider_metadata returns EndpointMaybeSet for token URL, set_token_uri() promotes to EndpointSet (required for exchange_code())"
  - "macro_rules! keasy_client_base! used to avoid repeating 17-parameter type with only HasAuthUrl/HasTokenUrl/HasUserInfoUrl varying between aliases"
  - "discover_async() takes owned IssuerUrl (not reference) in openidconnect 4.x — different from 3.x API"
  - "exchange_code() returns CodeTokenRequest directly (not Result) — no .map_err() wrapper needed"
  - "OIDC errors (state mismatch, token invalid, etc.) return 302 redirects to /login?error=auth_failed instead of JSON — browser-facing endpoints require redirect-based error handling"
metrics:
  duration_minutes: 9
  completed_date: "2026-02-27"
  tasks_completed: 2
  files_modified: 9
  files_created: 1
---

# Phase 11 Plan 01: OIDC Relying Party Core Summary

OIDC authorization code flow with PKCE S256, ID token verification via cached JWKS, Keycloak subject-based user upsert, and complete session management in Axum using openidconnect 4.0 directly.

## What Was Built

### auth/oidc.rs (new, ~380 lines)

**Types:**
- `KeyasyIdTokenClaims` — custom claims struct with `#[serde(rename = "keasy:dataspaces")]` multivalued claim
- `KeyasyClientDiscovered` / `KeyasyClient` — two type aliases for the fully-parameterized openidconnect `Client<...>` with 17 type parameters (see Deviations for why two aliases were needed)
- `OidcState` — OIDC client + `Arc<RwLock<CachedProviderMetadata>>` + HTTP client + issuer URL
- `CachedProviderMetadata` — provider metadata snapshot with `jiff::Timestamp` for TTL

**Functions:**
- `build_oidc_client()` — async discovery via `CoreProviderMetadata::discover_async()`, constructs `KeyasyClient` with explicit `set_token_uri()` call
- `OidcState::refresh_provider_metadata()` — re-fetches discovery doc, updates RwLock cache
- `OidcState::is_cache_stale()` — 15-minute TTL check using `jiff::Timestamp::duration_since()`

**Handlers:**
- `oidc_start` — PKCE S256 challenge generation, session store (verifier + CSRF state + nonce), optional `prompt=create` for registration flow, explicit `session.save()` before redirect
- `oidc_callback` — CSRF validation, code exchange with PKCE verifier, ID token signature verification (retry once after JWKS refresh), user upsert by subject, session cycle + setup, invite auto-accept

### DB Changes

- `db/schema.rs`: `ALTER TABLE users ADD COLUMN subject TEXT UNIQUE` migration (idempotent — error ignored if column exists)
- `db/users.rs`: `get_user_by_subject()` for active user lookup by Keycloak `sub` claim; `upsert_user_by_subject()` with email update path for existing users and INSERT with `password_hash = ""` for new OIDC users

### Route Changes

- `routes/mod.rs`: `/v1/auth/oidc-start` and `/v1/auth/oidc-callback` added as public auth routes (no session middleware — session is created inside oidc_callback)
- `auth/routes.rs`: `logout` returns `{"end_session_url": "..."}` instead of 204; `get_me` defaults `auth_method` to `"oidc"` instead of `"password"`
- `main.rs`: OIDC client built at startup from env vars; `oidc_state: Option<Arc<OidcState>>` added to AppState

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - API Mismatch] openidconnect 4.x requires two type aliases for KeyasyClient**

- **Found during:** Task 1 — `cargo check` failed with "function or associated item not found"
- **Issue:** The plan specified a single `KeyasyClient` type alias with `EndpointSet` for `HasTokenUrl`. However, `from_provider_metadata()` is only available on `Client<..., EndpointSet, ..., EndpointMaybeSet, EndpointMaybeSet>` (i.e., token URL is `EndpointMaybeSet` after discovery). To call `exchange_code()`, the token URL must be `EndpointSet` — requiring an explicit `set_token_uri()` call. This creates a type mismatch: you can't call `from_provider_metadata` on a type that already has `EndpointSet` for the token URL.
- **Fix:** Created two type aliases: `KeyasyClientDiscovered` (HasTokenUrl = `EndpointMaybeSet`, used for `from_provider_metadata()`) and `KeyasyClient` (HasTokenUrl = `EndpointSet`, used for `exchange_code()`). Used `macro_rules! keasy_client_base!` to avoid repeating the 17-parameter type. `build_oidc_client()` calls `KeyasyClientDiscovered::from_provider_metadata()` then `.set_token_uri()` to produce `KeyasyClient`.
- **Files modified:** `server/src/auth/oidc.rs`
- **Commit:** a99f1f3

**2. [Rule 1 - API Mismatch] discover_async() takes owned IssuerUrl in 4.x**

- **Found during:** Task 1 — `cargo check` error "expected IssuerUrl, found &IssuerUrl"
- **Issue:** The plan example and research patterns used `&issuer` for `discover_async()`. In openidconnect 4.0.1, `discover_async` takes an owned `IssuerUrl` (moved), not a reference.
- **Fix:** Changed `&issuer` to `issuer` in both `build_oidc_client()` and `refresh_provider_metadata()`.
- **Files modified:** `server/src/auth/oidc.rs`
- **Commit:** a99f1f3

**3. [Rule 1 - API Mismatch] exchange_code() returns CodeTokenRequest directly (not Result)**

- **Found during:** Task 2 — `cargo check` error "method not found in CodeTokenRequest"
- **Issue:** The plan suggested adding `.map_err()` after `exchange_code()`. In the openidconnect 4.x API, `exchange_code()` returns `CodeTokenRequest<TE, TR>` directly (not `Result`) — it's a builder, not a fallible operation. The error only occurs at `.request_async()`.
- **Fix:** Removed the `.map_err()` call after `exchange_code()`.
- **Files modified:** `server/src/auth/oidc.rs`
- **Commit:** 5356bb9

**4. [Rule 1 - API Mismatch] jiff 0.2 duration_since returns SignedDuration directly**

- **Found during:** Task 1 — `cargo check` error "expected SignedDuration, found Result"
- **Issue:** The plan's `is_cache_stale()` used `match duration_since(...) { Ok(d) => ..., Err(_) => ... }`. In jiff 0.2, `Timestamp::duration_since()` returns `SignedDuration` directly (not `Result`) — negative values indicate the clock went backwards.
- **Fix:** Updated `is_cache_stale()` to use the returned `SignedDuration` directly, treating negative values (clock skew) as stale.
- **Files modified:** `server/src/auth/oidc.rs`
- **Commit:** a99f1f3

**5. [Rule 1 - Bug] Temporary borrow in logout handler**

- **Found during:** Task 2 — `cargo check` error "temporary value dropped while borrowed"
- **Issue:** `urlencoding::encode(&format!(...))` created a temporary `String` that was dropped before `encoded_redirect` was used in the `format!` call.
- **Fix:** Extracted the format into a `let post_logout_uri = format!(...);` binding before calling `urlencoding::encode()`.
- **Files modified:** `server/src/auth/routes.rs`
- **Commit:** 5356bb9

## Self-Check: PASSED

- [x] server/src/auth/oidc.rs exists (FOUND)
- [x] server/src/auth/errors.rs has OIDC variants (FOUND)
- [x] server/src/db/schema.rs has subject migration (FOUND)
- [x] server/src/db/users.rs has upsert_user_by_subject (FOUND)
- [x] server/src/routes/mod.rs has OIDC routes (FOUND)
- [x] server/src/auth/routes.rs has end_session_url (FOUND)
- [x] commit a99f1f3 exists (FOUND)
- [x] commit 5356bb9 exists (FOUND)
