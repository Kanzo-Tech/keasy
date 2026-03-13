use std::collections::HashMap;
use std::sync::Arc;

use fossil_lang::compiler::{CompileResult, Compiler, CompilerInput};
use fossil_lang::passes::GlobalContext;
use fossil_lang::runtime::executor::{ExecutionConfig, ExecutionResult, IrExecutor};
use fossil_lang::traits::provider::LocalFileReader;

use crate::cloud::reader::CloudReader;

pub fn compile(name: &str, source: &str, storage: HashMap<String, String>) -> Result<CompileResult, Vec<String>> {
    let gcx = init_context(storage);
    let compiler = Compiler::with_context(gcx);
    compiler
        .compile(CompilerInput::Source {
            name: name.to_string(),
            content: source.to_string(),
        })
        .map_err(|errors| errors.0.into_iter().map(|e| e.to_string()).collect())
}

pub fn execute(result: CompileResult, config: ExecutionConfig) -> Result<ExecutionResult, String> {
    IrExecutor::execute_with_config(result.program, config)
        .map_err(|e| e.to_string())
}

pub fn init_context(storage: HashMap<String, String>) -> GlobalContext {
    let reader = Arc::new(CloudReader::new(
        Box::new(LocalFileReader),
        storage.clone(),
    ));
    let mut gcx = GlobalContext { storage, file_reader: reader, ..Default::default() };
    fossil_providers::init(&mut gcx);
    fossil_ifc::init(&mut gcx);
    fossil_stdlib::init(&mut gcx);
    gcx
}
