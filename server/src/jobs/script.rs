//! Fossil script compilation (Salsa-based).
//!
//! Pipeline: source → parse → lower → infer → rq (fossil-lang)
//!           rq → plan (keasy, via DuckDbDialect)

use fossil_lang::db::SourceFile;
use fossil_lang::plan::FossilPlan;
use fossil_lang::FossilDb;

use super::fossil_sources::DuckDbDialect;

/// Compile a Fossil script to a FossilPlan (SQL + metadata).
///
/// `db` is the cached FossilDb constructed at server startup
/// (see `AppState.fossil_db` / `build_fossil_db()`).
pub fn compile_to_plan(
    db: &FossilDb,
    name: &str,
    source: &str,
) -> Result<FossilPlan, Vec<String>> {
    let file = SourceFile::new(db, source.into(), name.into());

    // Run compiler pipeline up to rq().
    let rq = fossil_lang::queries::rq(db, file);
    let diagnostics =
        fossil_lang::queries::rq::accumulated::<fossil_lang::db::Diagnostic>(db, file);

    let errors: Vec<String> = diagnostics
        .iter()
        .filter(|d| d.severity == fossil_lang::db::Severity::Error)
        .map(|d| d.message.clone())
        .collect();

    if errors.is_empty() {
        Ok(FossilPlan::from_rq(rq, &DuckDbDialect))
    } else {
        Err(errors)
    }
}
