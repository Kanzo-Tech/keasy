//! Plan executor — runs FossilPlan against DuckDB.
//!
//! Handlers are registered via builder pattern for extensibility.
//! Reference: DataFusion SessionContext, dbt Adapter.

use std::collections::HashMap;
use std::sync::Arc;

use fossil_lang::plan::{FossilPlan, OutputResult};

use super::duckdb::DuckDbConn;

/// Loads external data into DuckDB before SQL execution.
///
/// After fossil-lang's catalog-based refactor, every source referenced
/// by a fossil script produces a `plan.sources` entry. The executor
/// dispatches each entry to the handler registered for its `format`,
/// which must make `def.alias` resolvable in DuckDB before the compiled
/// SQL runs (typically via `CREATE OR REPLACE VIEW`).
pub trait SourceHandler: Send + Sync {
    /// The source format this handler resolves (`csv`, `parquet`, `pdf`, …).
    fn format(&self) -> &str;
    fn load(&self, conn: &DuckDbConn, def: &fossil_lang::plan::SourceDef) -> Result<(), String>;
}

/// Plan executor — runs FossilPlan steps against DuckDB.
pub struct Executor {
    conn: DuckDbConn,
    sources: HashMap<String, Arc<dyn SourceHandler>>,
}

impl Executor {
    pub fn new(conn: DuckDbConn) -> Self {
        Self {
            conn,
            sources: HashMap::new(),
        }
    }

    pub fn source(mut self, handler: impl SourceHandler + 'static) -> Self {
        self.sources
            .insert(handler.format().to_string(), Arc::new(handler));
        self
    }

    /// Execute a FossilPlan: sources → SQL → outputs.
    pub fn execute(&self, plan: &FossilPlan) -> Result<Vec<OutputResult>, ExecutionError> {
        // Phase 1: register each fossil source in the DuckDB catalog.
        for source_def in &plan.sources {
            let handler = self
                .sources
                .get(&source_def.format)
                .ok_or_else(|| ExecutionError::UnknownHandler(source_def.format.clone()))?;
            handler
                .load(&self.conn, source_def)
                .map_err(ExecutionError::Handler)?;
        }

        // Phase 2: Execute SQL
        if !plan.sql.is_empty() {
            self.conn
                .execute_batch(&plan.sql)
                .map_err(|e| ExecutionError::Sql(e.to_string()))?;
        }

        let results = plan
            .outputs
            .iter()
            .map(|o| OutputResult {
                path: o.path.clone(),
                format: o.format.clone(),
            })
            .collect();

        Ok(results)
    }

}

#[derive(Debug, thiserror::Error)]
pub enum ExecutionError {
    #[error("unknown handler: {0}")]
    UnknownHandler(String),
    #[error("SQL error: {0}")]
    Sql(String),
    #[error("handler error: {0}")]
    Handler(String),
}
