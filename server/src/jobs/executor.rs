//! Plan executor — runs FossilPlan steps against a SQL engine.
//!
//! The executor is generic over `C: SqlEngine` (static dispatch).
//! Handlers (SourceHandler, OutputHandler) are registered via builder pattern.
//!
//! Reference: DataFusion SessionContext, dbt Adapter, Terraform Provider.

use std::collections::HashMap;
use std::sync::Arc;

use fossil_lang::plan::{FossilPlan, OutputResult};
use fossil_lang::registry::{OutputHandler, SourceHandler, SqlEngine};

/// Plan executor — runs FossilPlan steps against a SQL engine.
///
/// Generic over C: SqlEngine for static dispatch. DuckDB is one impl.
pub struct Executor<C: SqlEngine> {
    conn: C,
    sources: HashMap<String, Arc<dyn SourceHandler<C>>>,
    outputs: HashMap<String, Arc<dyn OutputHandler<C>>>,
}

impl<C: SqlEngine> Executor<C> {
    pub fn new(conn: C) -> Self {
        Self {
            conn,
            sources: HashMap::new(),
            outputs: HashMap::new(),
        }
    }

    pub fn source(mut self, handler: impl SourceHandler<C> + 'static) -> Self {
        self.sources
            .insert(handler.name().to_string(), Arc::new(handler));
        self
    }

    pub fn output(mut self, handler: impl OutputHandler<C> + 'static) -> Self {
        self.outputs
            .insert(handler.name().to_string(), Arc::new(handler));
        self
    }

    /// Execute a FossilPlan: sources → SQL → outputs.
    pub fn execute(&self, plan: &FossilPlan) -> Result<Vec<OutputResult>, ExecutionError> {
        // Phase 1: Load sources (preprocessing)
        for source_def in &plan.sources {
            let handler = self
                .sources
                .get(&source_def.handler)
                .ok_or_else(|| ExecutionError::UnknownHandler(source_def.handler.clone()))?;
            handler
                .load(&self.conn, source_def)
                .map_err(ExecutionError::Handler)?;
        }

        // Phase 2: Execute SQL (single query with CTEs)
        if !plan.sql.is_empty() {
            self.conn
                .execute_batch(&plan.sql)
                .map_err(|e| ExecutionError::Sql(e.to_string()))?;
        }

        // Phase 3: Write outputs
        let mut results = Vec::new();
        for output_def in &plan.outputs {
            let handler = self
                .outputs
                .get(&output_def.format)
                .ok_or_else(|| ExecutionError::UnknownHandler(output_def.format.clone()))?;
            let result = handler
                .write(&self.conn, output_def)
                .map_err(ExecutionError::Handler)?;
            results.push(result);
        }

        Ok(results)
    }

    /// Access the underlying connection (for DCAT catalog generation etc.)
    pub fn conn(&self) -> &C {
        &self.conn
    }
}

/// Errors during plan execution.
#[derive(Debug, thiserror::Error)]
pub enum ExecutionError {
    #[error("unknown handler: {0}")]
    UnknownHandler(String),
    #[error("SQL error: {0}")]
    Sql(String),
    #[error("handler error: {0}")]
    Handler(String),
}
