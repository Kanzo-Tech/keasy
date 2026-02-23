mod extract;
mod types;

pub use extract::extract_summary;
pub use types::*;

use fossil_lang::context::{DefId, DefKind, Interner, Symbol};
use fossil_lang::ir::{ExprId, ExprKind, Ir, PrimitiveType, TypeKind};
use fossil_lang::passes::IrProgram;
use fossil_stdlib::rdf::metadata::{RdfFieldAttrs, RdfTypeAttrs};

pub struct ProgramQuery<'a> {
    program: &'a IrProgram,
}

impl<'a> ProgramQuery<'a> {
    pub fn new(program: &'a IrProgram) -> Self {
        Self { program }
    }

    pub fn ir(&self) -> &Ir {
        &self.program.ir
    }

    pub fn interner(&self) -> &Interner {
        &self.program.gcx.interner
    }

    pub fn resolve_type_name(&self, expr_id: ExprId) -> Option<(String, DefId)> {
        let type_id = self.program.typeck_results.expr_types.get(&expr_id)?;
        let ty = self.program.ir.types.get(*type_id);
        if let TypeKind::Named(def_id) = &ty.kind {
            let def = self.program.gcx.definitions.get(*def_id);
            let name = self.interner().resolve(def.name).to_string();
            Some((name, *def_id))
        } else {
            None
        }
    }

    pub fn resolve_fields(&self, expr_id: ExprId) -> Vec<Field> {
        let type_id = match self.program.typeck_results.expr_types.get(&expr_id) {
            Some(id) => id,
            None => return Vec::new(),
        };
        let ty = self.program.ir.types.get(*type_id);
        match &ty.kind {
            TypeKind::Named(def_id) => self.lookup_fields_by_def(*def_id),
            TypeKind::Record(rf) => self.record_to_fields(rf, None),
            _ => Vec::new(),
        }
    }

    pub fn lookup_fields_by_def(&self, def_id: DefId) -> Vec<Field> {
        let info = match self.program.type_index.get(def_id) {
            Some(i) => i,
            None => return Vec::new(),
        };

        let ty = self.program.ir.types.get(info.ty);
        let record_fields = match &ty.kind {
            TypeKind::Record(rf) => rf,
            _ => {
                return info
                    .field_names
                    .iter()
                    .map(|s| Field {
                        name: self.interner().resolve(*s).to_string(),
                        field_type: "String".to_string(),
                        uri: None,
                    })
                    .collect();
            }
        };

        self.record_to_fields(record_fields, Some(def_id))
    }

    fn record_to_fields(
        &self,
        rf: &fossil_lang::ir::RecordFields,
        def_id: Option<DefId>,
    ) -> Vec<Field> {
        rf.fields
            .iter()
            .map(|(field_sym, field_type_id)| {
                let field_name = self.interner().resolve(*field_sym).to_string();
                let type_str = self.type_label(*field_type_id);
                let uri = def_id
                    .and_then(|id| self.program.gcx.type_metadata.get(&id))
                    .and_then(|tm| tm.field_metadata.get(field_sym))
                    .map(|fm| RdfFieldAttrs::from_field_metadata(fm, self.interner()))
                    .and_then(|attrs| attrs.uri);
                Field {
                    name: field_name,
                    field_type: type_str,
                    uri,
                }
            })
            .collect()
    }

    fn type_label(&self, type_id: fossil_lang::ir::TypeId) -> String {
        let ty = self.program.ir.types.get(type_id);
        match &ty.kind {
            TypeKind::Primitive(PrimitiveType::Int) => "Int".to_string(),
            TypeKind::Primitive(PrimitiveType::Float) => "Float".to_string(),
            TypeKind::Primitive(PrimitiveType::String) => "String".to_string(),
            TypeKind::Primitive(PrimitiveType::Bool) => "Bool".to_string(),
            TypeKind::Named(def_id) => {
                let def = self.program.gcx.definitions.get(*def_id);
                self.interner().resolve(def.name).to_string()
            }
            TypeKind::Optional(inner) => format!("{}?", self.type_label(*inner)),
            TypeKind::Function(_, _) => "Function".to_string(),
            TypeKind::Unit => "Unit".to_string(),
            TypeKind::Record(_) => "Record".to_string(),
            TypeKind::Var(_) => "Unknown".to_string(),
        }
    }

    pub fn lookup_fields(&self, name: Symbol) -> Vec<Field> {
        let def = self
            .program
            .gcx
            .definitions
            .find_by_symbol(name, |k| matches!(k, DefKind::Type));
        match def {
            Some(d) => self.lookup_fields_by_def(d.id()),
            None => Vec::new(),
        }
    }

    pub fn extract_rdf_type(&self, name: Symbol) -> Option<String> {
        let def = self
            .program
            .gcx
            .definitions
            .find_by_symbol(name, |k| matches!(k, DefKind::Type));
        def.and_then(|d| RdfTypeAttrs::from_def_id(d.id(), &self.program.gcx))
            .and_then(|attrs| attrs.rdf_type)
    }

    pub fn resolve_ctor_params(&self, type_name: &fossil_lang::common::Path) -> Vec<String> {
        let syms: Vec<Symbol> = type_name.clone().into();
        syms.last()
            .and_then(|&s| self.lookup_type_info(s))
            .map(|info| {
                info.ctor_param_names
                    .iter()
                    .map(|s| self.interner().resolve(*s).to_string())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn resolve_expr_display(&self, expr_id: ExprId) -> String {
        let expr_id = self
            .program
            .resolutions
            .expr_rewrites
            .get(&expr_id)
            .copied()
            .unwrap_or(expr_id);
        let expr = self.ir().exprs.get(expr_id);
        match &expr.kind {
            ExprKind::FieldAccess { expr: inner, field } => {
                let field_name = self.interner().resolve(*field).to_string();
                let inner_expr = self.ir().exprs.get(*inner);
                if matches!(&inner_expr.kind, ExprKind::Identifier(_)) {
                    field_name
                } else {
                    format!("{}.{}", self.resolve_expr_display(*inner), field_name)
                }
            }
            ExprKind::Identifier(path) => path.display(self.interner()),
            ExprKind::Literal(lit) => match lit {
                fossil_lang::ir::Literal::String(s) => {
                    format!("\"{}\"", self.interner().resolve(*s))
                }
                fossil_lang::ir::Literal::Integer(n) => n.to_string(),
                fossil_lang::ir::Literal::Boolean(b) => b.to_string(),
            },
            _ => "\u{2026}".to_string(),
        }
    }

    pub fn resolve_callee_name(&self, callee: ExprId) -> Option<String> {
        let callee_expr = self.ir().exprs.get(callee);
        match &callee_expr.kind {
            ExprKind::Identifier(path) => Some(path.display(self.interner())),
            ExprKind::FieldAccess { expr: obj, field } => {
                let obj_expr = self.ir().exprs.get(*obj);
                match &obj_expr.kind {
                    ExprKind::Identifier(path) => Some(format!(
                        "{}.{}",
                        path.display(self.interner()),
                        self.interner().resolve(*field)
                    )),
                    _ => Some(self.interner().resolve(*field).to_string()),
                }
            }
            _ => None,
        }
    }

    fn lookup_type_info(&self, name: Symbol) -> Option<&fossil_lang::ir::TypeDeclInfo> {
        let def = self
            .program
            .gcx
            .definitions
            .find_by_symbol(name, |k| matches!(k, DefKind::Type));
        def.and_then(|d| self.program.type_index.get(d.id()))
    }
}
