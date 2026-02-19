use std::collections::BTreeMap;

use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};

use fossil_lang::context::{DefKind, Interner, Symbol};
use fossil_lang::ir::{ExprKind, Ir, PrimitiveType, StmtKind, TypeKind};
use fossil_lang::passes::IrProgram;
use fossil_stdlib::rdf::metadata::RdfMetadata;

use crate::AppState;
use crate::script::ScriptContext;

#[derive(Deserialize)]
pub struct ValidateRequest {
    pub script: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SourceInfo {
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FieldMapping {
    pub target: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OutputInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub type_name: String,
    pub ctor_params: Vec<String>,
    pub fields: Vec<String>,
    pub destination: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mappings: Vec<FieldMapping>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub field_types: BTreeMap<String, String>,
    /// field name → RDF predicate IRI (from @rdf(uri = "...") annotations)
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub field_uris: BTreeMap<String, String>,
}

#[derive(Serialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub sources: Vec<SourceInfo>,
    pub outputs: Vec<OutputInfo>,
    pub errors: Vec<String>,
}

pub async fn validate_script(
    State(state): State<AppState>,
    Json(payload): Json<ValidateRequest>,
) -> impl IntoResponse {
    let script = payload.script;
    let cloud_accounts = state.cloud_accounts.clone();

    let result = tokio::task::spawn_blocking(move || {
        // Build StorageConfig from all cloud accounts for validation
        let all_ids: Vec<String> = cloud_accounts.list().iter().map(|a| a.id.clone()).collect();
        let storage = cloud_accounts.build_storage_config(&all_ids);
        let ctx = ScriptContext::new();
        match ctx.compile("validate", &script, storage) {
            Ok(result) => extract_summary(&result.program),
            Err(errors) => ValidationResult {
                valid: false,
                sources: vec![],
                outputs: vec![],
                errors,
            },
        }
    })
    .await;

    match result {
        Ok(validation) => (StatusCode::OK, Json(validation)),
        Err(join_err) => (
            StatusCode::OK,
            Json(ValidationResult {
                valid: false,
                sources: vec![],
                outputs: vec![],
                errors: vec![format!("Internal error: {}", join_err)],
            }),
        ),
    }
}

fn extract_summary(program: &IrProgram) -> ValidationResult {
    let ir = &program.ir;
    let interner = &program.gcx.interner;

    let mut sources = Vec::new();
    let mut outputs = Vec::new();

    let mut provider_symbols: std::collections::HashSet<Symbol> = std::collections::HashSet::new();

    for &stmt_id in &ir.root {
        let stmt = ir.stmts.get(stmt_id);
        if let StmtKind::Let { name, value } = &stmt.kind {
            let expr = ir.exprs.get(*value);
            if let ExprKind::Application { callee, .. } = &expr.kind {
                let callee_name = resolve_callee_name(ir, interner, *callee);
                if let Some(ref cn) = callee_name {
                    let binding_name = interner.resolve(*name);
                    if cn == &format!("{}.load", binding_name) {
                        provider_symbols.insert(*name);
                    }
                }
            }
        }
    }

    for &stmt_id in &ir.root {
        let stmt = ir.stmts.get(stmt_id);
        match &stmt.kind {
            StmtKind::Type { name, .. } => {
                if provider_symbols.contains(name) {
                    let type_name = interner.resolve(*name).to_string();
                    let fields = lookup_type_fields(program, *name);
                    sources.push(SourceInfo { name: type_name, fields });
                }
            }
            StmtKind::Let { name, value } => {
                if provider_symbols.contains(name) {
                    continue;
                }
                let mut source_name = None;
                let before = outputs.len();
                collect_pipeline(ir, interner, program, *value, &mut outputs, &mut source_name);
                if outputs.len() == before {
                    let binding_name = interner.resolve(*name).to_string();
                    let fields = lookup_type_fields(program, *name);
                    sources.push(SourceInfo { name: binding_name, fields });
                }
            }
            StmtKind::Expr(expr_id) => {
                let mut source_name = None;
                collect_pipeline(ir, interner, program, *expr_id, &mut outputs, &mut source_name);
            }
        }
    }

    ValidationResult {
        valid: true,
        sources,
        outputs,
        errors: vec![],
    }
}

/// Walk a pipeline expression to extract output info (type, ctor params, fields, destination).
fn collect_pipeline(
    ir: &Ir,
    interner: &Interner,
    program: &IrProgram,
    expr_id: fossil_lang::ir::ExprId,
    outputs: &mut Vec<OutputInfo>,
    source_name: &mut Option<String>,
) {
    let expr = ir.exprs.get(expr_id);
    match &expr.kind {
        ExprKind::Projection { source, outputs: out_exprs, .. } => {
            // Resolve source binding name for this projection
            if source_name.is_none() {
                *source_name = resolve_source_name(ir, interner, *source);
            }

            for &out_id in out_exprs {
                let out_expr = ir.exprs.get(out_id);
                if let ExprKind::RecordInstance { type_name, ctor_args, fields, .. } = &out_expr.kind {
                    let name = type_name.display(interner);
                    let ctor_params = resolve_ctor_params(program, type_name);
                    let field_names: Vec<String> = fields
                        .iter()
                        .map(|(sym, _)| interner.resolve(*sym).to_string())
                        .collect();

                    let mut mappings = Vec::new();
                    for (param_name, arg) in ctor_params.iter().zip(ctor_args.iter()) {
                        let source_expr = resolve_expr_display(ir, interner, arg.value());
                        mappings.push(FieldMapping {
                            target: param_name.clone(),
                            source: source_expr,
                        });
                    }

                    for (sym, value_expr) in fields {
                        let target = interner.resolve(*sym).to_string();
                        let source_expr = resolve_expr_display(ir, interner, *value_expr);
                        mappings.push(FieldMapping {
                            target,
                            source: source_expr,
                        });
                    }

                    let (field_types, field_uris) = {
                        let syms: Vec<Symbol> = type_name.clone().into();
                        match syms.last() {
                            Some(&s) => (lookup_field_types(program, s), lookup_field_uris(program, s)),
                            None => (BTreeMap::new(), BTreeMap::new()),
                        }
                    };

                    outputs.push(OutputInfo {
                        source: source_name.clone(),
                        type_name: name,
                        ctor_params: ctor_params.clone(),
                        fields: field_names,
                        destination: None,
                        mappings,
                        field_types,
                        field_uris,
                    });
                }
            }
        }
        ExprKind::Application { callee, args } => {
            // Recurse into arguments FIRST (the pipeline source is typically the first arg)
            for arg in args {
                collect_pipeline(ir, interner, program, arg.value(), outputs, source_name);
            }

            // THEN apply destination to the last output
            let callee_name = resolve_callee_name(ir, interner, *callee);
            if let Some(ref name) = callee_name {
                if name.contains("serialize") || name.contains("write") {
                    let dest = args.iter().find_map(|arg| {
                        let arg_expr = ir.exprs.get(arg.value());
                        if let ExprKind::Literal(fossil_lang::ir::Literal::String(s)) = &arg_expr.kind {
                            Some(interner.resolve(*s).to_string())
                        } else {
                            None
                        }
                    });

                    if let Some(dest) = dest {
                        if let Some(last) = outputs.last_mut() {
                            last.destination = Some(dest);
                        }
                    }
                }
            }
        }
        ExprKind::FieldAccess { expr: inner, .. } => {
            collect_pipeline(ir, interner, program, *inner, outputs, source_name);
        }
        _ => {}
    }
}

/// Resolve an expression to a human-readable source display string.
/// For `x.Name` returns `"Name"`, for `x.Address.City` returns `"Address.City"`, etc.
fn resolve_expr_display(ir: &Ir, interner: &Interner, expr_id: fossil_lang::ir::ExprId) -> String {
    let expr = ir.exprs.get(expr_id);
    match &expr.kind {
        ExprKind::FieldAccess { expr: inner, field } => {
            let field_name = interner.resolve(*field).to_string();
            let inner_expr = ir.exprs.get(*inner);
            // If the inner is just an identifier (the binding param like `x`), show only the field
            if matches!(&inner_expr.kind, ExprKind::Identifier(_)) {
                field_name
            } else {
                format!("{}.{}", resolve_expr_display(ir, interner, *inner), field_name)
            }
        }
        ExprKind::Identifier(path) => path.display(interner),
        ExprKind::Literal(lit) => match lit {
            fossil_lang::ir::Literal::String(s) => {
                format!("\"{}\"", interner.resolve(*s))
            }
            fossil_lang::ir::Literal::Integer(n) => n.to_string(),
            fossil_lang::ir::Literal::Boolean(b) => b.to_string(),
        },
        _ => "\u{2026}".to_string(),
    }
}

/// Trace an expression back to its root binding name.
fn resolve_source_name(ir: &Ir, interner: &Interner, expr_id: fossil_lang::ir::ExprId) -> Option<String> {
    let expr = ir.exprs.get(expr_id);
    match &expr.kind {
        ExprKind::Identifier(path) => Some(path.display(interner)),
        ExprKind::Application { args, .. } => {
            // Pipeline source is the first argument
            args.first().and_then(|arg| resolve_source_name(ir, interner, arg.value()))
        }
        ExprKind::FieldAccess { expr: inner, .. } => {
            resolve_source_name(ir, interner, *inner)
        }
        _ => None,
    }
}

/// Look up the TypeDeclInfo for a type symbol via the type_index.
fn lookup_type_info<'a>(program: &'a IrProgram, name: Symbol) -> Option<&'a fossil_lang::ir::TypeDeclInfo> {
    let def = program
        .gcx
        .definitions
        .find_by_symbol(name, |k| matches!(k, DefKind::Type));
    def.and_then(|d| program.type_index.get(d.id()))
}

fn resolve_type_names(
    program: &IrProgram,
    name: Symbol,
    accessor: impl Fn(&fossil_lang::ir::TypeDeclInfo) -> &[Symbol],
) -> Vec<String> {
    let interner = &program.gcx.interner;
    lookup_type_info(program, name)
        .map(|info| accessor(info).iter().map(|s| interner.resolve(*s).to_string()).collect())
        .unwrap_or_default()
}

fn resolve_ctor_params(program: &IrProgram, type_name: &fossil_lang::common::Path) -> Vec<String> {
    let syms: Vec<fossil_lang::context::Symbol> = type_name.clone().into();
    match syms.last() {
        Some(&s) => resolve_type_names(program, s, |info| &info.ctor_param_names),
        None => vec![],
    }
}

fn lookup_type_fields(program: &IrProgram, name: Symbol) -> Vec<String> {
    resolve_type_names(program, name, |info| &info.field_names)
}

/// Resolve field names to their primitive types via the IR type system.
/// Returns e.g. { "age": "Int", "name": "String" }.
fn lookup_field_types(program: &IrProgram, name: Symbol) -> BTreeMap<String, String> {
    let interner = &program.gcx.interner;
    let info = match lookup_type_info(program, name) {
        Some(i) => i,
        None => return BTreeMap::new(),
    };
    let ty = program.ir.types.get(info.ty);
    let record_fields = match &ty.kind {
        TypeKind::Record(rf) => rf,
        _ => return BTreeMap::new(),
    };
    let mut result = BTreeMap::new();
    for (field_sym, field_type_id) in &record_fields.fields {
        let field_name = interner.resolve(*field_sym).to_string();
        let field_ty = program.ir.types.get(*field_type_id);
        let type_str = match &field_ty.kind {
            TypeKind::Primitive(PrimitiveType::Int) => "Int",
            TypeKind::Primitive(PrimitiveType::Float) => "Float",
            TypeKind::Primitive(PrimitiveType::String) => "String",
            TypeKind::Primitive(PrimitiveType::Bool) => "Bool",
            _ => "String",
        };
        result.insert(field_name, type_str.to_string());
    }
    result
}

/// Resolve field names to their @rdf(uri = "...") predicate IRIs via TypeMetadata.
fn lookup_field_uris(program: &IrProgram, name: Symbol) -> BTreeMap<String, String> {
    let interner = &program.gcx.interner;
    let def = program
        .gcx
        .definitions
        .find_by_symbol(name, |k| matches!(k, DefKind::Type));
    let def = match def {
        Some(d) => d,
        None => return BTreeMap::new(),
    };
    let rdf_meta = program
        .gcx
        .type_metadata
        .get(&def.id())
        .and_then(|tm| RdfMetadata::from_type_metadata(tm, interner));
    let rdf_meta = match rdf_meta {
        Some(m) => m,
        None => return BTreeMap::new(),
    };
    let mut result = BTreeMap::new();
    for (sym, field_info) in &rdf_meta.fields {
        let field_name = interner.resolve(*sym).to_string();
        result.insert(field_name, field_info.uri.clone());
    }
    result
}

/// Resolve a callee expression to a human-readable name like "data.load" or "Rdf.serialize".
fn resolve_callee_name(ir: &Ir, interner: &Interner, callee: fossil_lang::ir::ExprId) -> Option<String> {
    let callee_expr = ir.exprs.get(callee);
    match &callee_expr.kind {
        ExprKind::Identifier(path) => Some(path.display(interner)),
        ExprKind::FieldAccess { expr: obj, field } => {
            let obj_expr = ir.exprs.get(*obj);
            match &obj_expr.kind {
                ExprKind::Identifier(path) => Some(format!(
                    "{}.{}",
                    path.display(interner),
                    interner.resolve(*field)
                )),
                _ => Some(interner.resolve(*field).to_string()),
            }
        }
        _ => None,
    }
}
