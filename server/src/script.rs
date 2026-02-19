use fossil_lang::compiler::{CompileResult, Compiler, CompilerInput};
use fossil_lang::passes::GlobalContext;
use fossil_lang::runtime::executor::{ExecutionConfig, IrExecutor};
use fossil_lang::runtime::storage::StorageConfig;

/// Shared context for compiling and executing Fossil scripts.
pub struct ScriptContext;

impl ScriptContext {
    pub fn new() -> Self {
        Self
    }

    pub fn compile(&self, name: &str, source: &str, storage: StorageConfig) -> Result<CompileResult, Vec<String>> {
        let gcx = init_context(storage);
        let compiler = Compiler::with_context(gcx);
        compiler
            .compile(CompilerInput::Source {
                name: name.to_string(),
                content: source.to_string(),
            })
            .map_err(|errors| errors.0.into_iter().map(|e| e.to_string()).collect())
    }

    pub fn execute(
        &self,
        result: CompileResult,
        config: ExecutionConfig,
    ) -> Result<(), String> {
        IrExecutor::execute_with_config(result.program, config)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn init_context(storage: StorageConfig) -> GlobalContext {
    let mut gcx = GlobalContext::default();
    gcx.storage = storage;
    fossil_providers::init(&mut gcx);
    fossil_ifc::init(&mut gcx);
    fossil_stdlib::init(&mut gcx);
    gcx
}
