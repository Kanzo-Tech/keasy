//! Fossil script compilation (Salsa-based).
//!
//! The old Compiler + IrExecutor path is gone. Compilation now goes through
//! the Salsa query graph: source -> parse -> lower -> infer -> rq -> plan.

use fossil_lang::db::{FossilDb, SourceFile};
use fossil_lang::plan::FossilPlan;

/// Compile a Fossil script to a FossilPlan (SQL + metadata).
pub fn compile_to_plan(name: &str, source: &str) -> Result<FossilPlan, Vec<String>> {
    let db = FossilDb::default();
    let file = SourceFile::new(&db, source.into(), name.into());

    // Collect diagnostics accumulated by the Salsa query.
    // plan::accumulated requires the tracked function module path.
    let plan = fossil_lang::queries::plan(&db, file);
    let diagnostics =
        fossil_lang::queries::plan::accumulated::<fossil_lang::db::Diagnostic>(&db, file);

    let errors: Vec<String> = diagnostics
        .iter()
        .filter(|d| d.severity == fossil_lang::db::Severity::Error)
        .map(|d| d.message.clone())
        .collect();

    if errors.is_empty() {
        Ok(plan)
    } else {
        Err(errors)
    }
}
