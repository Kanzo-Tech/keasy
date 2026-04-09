use std::sync::Arc;

use fossil_lang::compiler::{CompileResult, Compiler, CompilerInput};
use fossil_lang::passes::GlobalContext;
use fossil_lang::plan::FossilPlan;
use fossil_lang::registry::Registry;
use fossil_lang::runtime::executor::{ExecutionResult, IrExecutor};
use fossil_lang::traits::resolver::PathResolver;
use fossil_lang::traits::services::ExternalServices;

/// Compile a Fossil script to a FossilPlan (new path: SQL + metadata).
pub fn compile_to_plan(
    name: &str,
    source: &str,
    path_resolver: Arc<dyn PathResolver>,
    external_services: Option<Arc<dyn ExternalServices>>,
) -> Result<FossilPlan, Vec<String>> {
    let gcx = init_context(path_resolver, external_services);
    let registry = init_registry();
    fossil_lang::queries::compile_to_plan(source, name, gcx, &registry)
        .map_err(|errors| errors.0.into_iter().map(|e| e.to_string()).collect())
}

/// Legacy: compile (still needed for pipeline_extract and DCAT).
pub fn compile(name: &str, source: &str, path_resolver: Arc<dyn PathResolver>) -> Result<CompileResult, Vec<String>> {
    let gcx = init_context(path_resolver, None);
    let compiler = Compiler::with_context(gcx);
    compiler
        .compile(CompilerInput::Source {
            name: name.to_string(),
            content: source.to_string(),
        })
        .map_err(|errors| errors.0.into_iter().map(|e| e.to_string()).collect())
}

/// Legacy: execute with Polars (deprecated, use compile_to_plan + Executor).
pub fn execute(result: CompileResult) -> Result<ExecutionResult, String> {
    IrExecutor::execute(result.program)
        .map_err(|e| e.to_string())
}

pub fn init_context(
    path_resolver: Arc<dyn PathResolver>,
    external_services: Option<Arc<dyn ExternalServices>>,
) -> GlobalContext {
    let mut gcx = GlobalContext { path_resolver, external_services, ..Default::default() };
    fossil_providers::init(&mut gcx);
    fossil_doc::init(&mut gcx);
    fossil_stdlib::init(&mut gcx);
    gcx
}

/// Build the Registry with all available FunctionDefs and AttributeOps.
pub fn init_registry() -> Registry {
    let mut r = Registry::new();
    fossil_providers::register(&mut r);
    fossil_stdlib::register(&mut r);
    fossil_doc::register(&mut r);
    r
}
