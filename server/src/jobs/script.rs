use std::sync::Arc;

use fossil_lang::compiler::{CompileResult, Compiler, CompilerInput};
use fossil_lang::passes::GlobalContext;
use fossil_lang::traits::resolver::PathResolver;

pub fn compile(name: &str, source: &str, path_resolver: Arc<dyn PathResolver>) -> Result<CompileResult, Vec<String>> {
    let gcx = init_context(path_resolver);
    let compiler = Compiler::with_context(gcx);
    compiler
        .compile(CompilerInput::Source {
            name: name.to_string(),
            content: source.to_string(),
        })
        .map_err(|errors| errors.0.into_iter().map(|e| e.to_string()).collect())
}

pub fn init_context(path_resolver: Arc<dyn PathResolver>) -> GlobalContext {
    let mut gcx = GlobalContext { path_resolver, ..Default::default() };
    fossil_providers::init(&mut gcx);
    fossil_stdlib::init(&mut gcx);
    gcx
}
