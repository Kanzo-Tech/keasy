//! Host-side `@conn/path` resolver.
//!
//! Fossil scripts reference data via `@<connector-name>/<relative-path>`.
//! The compiler (fossil-lang) treats the path as opaque — translation to
//! a real cloud URL is keasy's responsibility. `KeasyPathResolver` does
//! that translation, holding all the per-connector state needed by the
//! job runtime in a single place:
//!
//!   - `base_url`        — concatenated with the relative path to form
//!                         the URL DuckDB sees in `read_csv`/`read_parquet`
//!   - `store`           — `Arc<dyn CloudStore>` shared across all
//!                         consumers (DuckDB SECRET install, presigning,
//!                         server-side reads/writes/listing)
//!   - `secret_spec`     — DuckDB SECRET parameters; the runner installs
//!                         a `CREATE OR REPLACE SECRET` per entry before
//!                         the executor runs
//!
//! One resolver instance per job, built in `routes::create_job` and
//! propagated through `SpawnParams`. Out of scope for this module: cloud
//! credential extraction (lives in `ConnectorType` impls).

use std::sync::Arc;

use crate::connectors::config::{CloudStore, DuckDbSecretSpec};

/// One connector authorized for a job, with all its runtime state pre-built.
pub struct ConnectorEntry {
    pub name: String,
    pub base_url: String,
    pub store: Arc<dyn CloudStore>,
    pub secret_spec: DuckDbSecretSpec,
}

impl std::fmt::Debug for ConnectorEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectorEntry")
            .field("name", &self.name)
            .field("base_url", &self.base_url)
            .finish()
    }
}

/// Host-provided path resolution for `@conn/...` references.
pub trait PathResolver: Send + Sync + std::fmt::Debug {
    /// Resolve `@name/path` to the full cloud URL (e.g. `s3://bucket/path`).
    /// Direct paths (without `@`) are rejected.
    fn resolve(&self, raw: &str) -> Result<String, String>;

    /// Resolve `@name/path` to the owning `ConnectorEntry`. Used by the
    /// data plane endpoint when it needs the entry's `store` for signing
    /// without re-walking the entries list.
    fn entry_for(&self, raw: &str) -> Result<&ConnectorEntry, String>;

    /// All entries authorized for this job. Used by the runner to install
    /// DuckDB SECRETs before the executor runs.
    fn entries(&self) -> &[ConnectorEntry];
}

/// Keasy's `PathResolver` impl: looks up `@name` against a fixed set of
/// connector entries authorized at job spawn time.
#[derive(Debug)]
pub struct KeasyPathResolver {
    entries: Vec<ConnectorEntry>,
}

impl KeasyPathResolver {
    pub fn new(entries: Vec<ConnectorEntry>) -> Self {
        Self { entries }
    }

    fn split_at(raw: &str) -> Result<(&str, &str), String> {
        if !raw.starts_with('@') {
            return Err(format!(
                "Direct paths not allowed. Use @connection/path: {raw}"
            ));
        }
        let without_at = &raw[1..];
        let (name, path) = without_at
            .split_once('/')
            .ok_or_else(|| format!("Invalid reference: {raw}. Expected @name/path"))?;
        Ok((name, path))
    }

    fn lookup(&self, name: &str) -> Result<&ConnectorEntry, String> {
        self.entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| format!("Unknown connection: @{name}"))
    }
}

impl PathResolver for KeasyPathResolver {
    fn resolve(&self, raw: &str) -> Result<String, String> {
        let (name, path) = Self::split_at(raw)?;
        let entry = self.lookup(name)?;
        Ok(format!(
            "{}/{}",
            entry.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        ))
    }

    fn entry_for(&self, raw: &str) -> Result<&ConnectorEntry, String> {
        let (name, _) = Self::split_at(raw)?;
        self.lookup(name)
    }

    fn entries(&self) -> &[ConnectorEntry] {
        &self.entries
    }
}
