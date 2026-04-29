//! Fossil script compilation (Salsa-based).
//!
//! Pipeline: source → parse → lower → infer → rq → plan (fossil-lang).
//!
//! After the catalog-based refactor, fossil-lang emits name-only SQL;
//! keasy resolves each source alias via the `SourceHandler` registered
//! in the `Executor` (see `fossil::DuckDbNativeHandler`).
//!
//! ## FossilDb lifecycle
//!
//! `FossilDb` is constructed **per job thread** in [`super::fossil::build_fossil_db`]
//! because Salsa's `Storage` is not Send+Sync. The shared piece is the
//! `FossilRegistry` (in `AppState`), which IS Send+Sync — the per-thread
//! db just clones the registry.
//!
//! Trade-off: per-thread fresh = no incremental cache across compilations.
//! For the current job execution flow this is fine (each job is one
//! compilation). For LSP-style live analysis, a long-lived db with Salsa
//! cancellation would be better — see `super::fossil_analysis`.

use fossil_lang::db::SourceFile;
use fossil_lang::plan::FossilPlan;
use fossil_lang::FossilDb;

/// Compile a Fossil script to a FossilPlan (SQL + metadata).
///
/// The caller owns the [`FossilDb`] and is responsible for its lifetime.
/// [`fossil_lang::queries::schema_needs`] could be called here to pre-fetch
/// remote schemas in parallel before `rq()`, but FossilDb's default
/// `HasSchemaResolver::source_schema` returns `None` and there is no
/// upstream API to inject a per-db schema cache yet — left as a future
/// enhancement (requires a fossil-lang change in ikigai-core).
pub fn compile_to_plan(
    db: &FossilDb,
    name: &str,
    source: &str,
) -> Result<FossilPlan, Vec<String>> {
    let file = SourceFile::new(db, source.into(), name.into());

    let rq = fossil_lang::queries::rq(db, file);
    let diagnostics =
        fossil_lang::queries::rq::accumulated::<fossil_lang::db::Diagnostic>(db, file);

    let errors: Vec<String> = diagnostics
        .iter()
        .filter(|d| d.severity == fossil_lang::db::Severity::Error)
        .map(|d| d.message.clone())
        .collect();

    if errors.is_empty() {
        Ok(FossilPlan::from_rq(rq))
    } else {
        Err(errors)
    }
}
