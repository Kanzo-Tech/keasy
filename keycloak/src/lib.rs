//! `keasy-keycloak` — the Keycloak Admin REST client shared by `keasy-server`
//! (per-instance OIDC + workspace claim management) and the `control-plane`
//! provisioner (OIDC client registration when creating a workspace).
//!
//! Extracted from `keasy-server` so the control-plane can reuse the exact same
//! client without pulling in the server's heavy dependency graph (DuckDB,
//! fossil, …). The module is self-contained: it depends only on `reqwest`,
//! `serde`, `secrecy`, `tokio`, and `tracing`.

pub mod admin;
