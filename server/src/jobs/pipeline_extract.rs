use std::collections::{HashMap, HashSet};

use fossil_lang::context::Symbol;
use fossil_lang::ir::{ExprId, ExprKind, StmtKind};

use super::pipeline_types::*;
use super::ProgramQuery;

fn extract_source_name(pq: &ProgramQuery, expr_id: ExprId) -> String {
    let expr = pq.ir().exprs.get(expr_id);
    if let ExprKind::Application { args, .. } = &expr.kind {
        for arg in args {
            let arg_expr = pq.ir().exprs.get(arg.value());
            if let ExprKind::Literal(fossil_lang::ir::Literal::String(s)) = &arg_expr.kind {
                let path = pq.interner().resolve(*s);
                return path.rsplit('/').next().unwrap_or(path).to_string();
            }
        }
    }
    "source".to_string()
}

#[derive(Default)]
struct ExtractionResult {
    source_type: Option<String>,
    outputs: Vec<PipelineOutput>,
    operations: Vec<PipelineOperation>,
    pending: Vec<PipelineOutput>,
}

pub fn extract_summary(program: &fossil_lang::passes::IrProgram) -> ValidationResult {
    let pq = ProgramQuery::new(program);
    let ir = pq.ir();

    let mut inputs = Vec::new();
    let mut seen_inputs = HashSet::new();
    let mut operations = Vec::new();
    let mut outputs = Vec::new();
    let mut source_labels: HashMap<Symbol, String> = HashMap::new();

    for &stmt_id in &ir.root {
        let stmt = ir.stmts.get(stmt_id);
        match &stmt.kind {
            StmtKind::Type { .. } => {}
            StmtKind::Let { name, value } => {
                let result = classify_expr(&pq, *value, &source_labels);
                if result.outputs.is_empty() && result.operations.is_empty() {
                    if let Some(ref label) = result.source_type {
                        // Expression references a known input (e.g. CleanData.clean(data))
                        // — map this binding to the same source.
                        source_labels.insert(*name, label.clone());
                    } else {
                        let (input_name, fields) = match pq.resolve_type_name(*value) {
                            Some((type_name, def_id)) => {
                                (type_name, pq.lookup_fields_by_def(def_id))
                            }
                            None => {
                                (extract_source_name(&pq, *value), pq.resolve_fields(*value))
                            }
                        };
                        if !fields.is_empty() && seen_inputs.insert(input_name.clone()) {
                            source_labels.insert(*name, input_name.clone());
                            inputs.push(PipelineInput { name: input_name, fields });
                        }
                    }
                } else {
                    operations.extend(result.operations);
                    outputs.extend(result.outputs);
                    outputs.extend(result.pending);
                }
            }
            StmtKind::Expr(expr_id) => {
                let result = classify_expr(&pq, *expr_id, &source_labels);
                operations.extend(result.operations);
                outputs.extend(result.outputs);
                outputs.extend(result.pending);
            }
        }
    }

    let mut merged_outputs: Vec<PipelineOutput> = Vec::new();
    for out in outputs {
        if let Some(existing) = merged_outputs.iter_mut().find(|o| o.type_name == out.type_name) {
            for m in &out.mappings {
                if !existing.mappings.iter().any(|em| em.target == m.target && em.source == m.source) {
                    existing.mappings.push(m.clone());
                }
            }
        } else {
            merged_outputs.push(out);
        }
    }
    let outputs = merged_outputs;

    ValidationResult {
        valid: true,
        pipeline: PipelineSummary { inputs, operations, outputs },
        errors: vec![],
    }
}

fn classify_expr(pq: &ProgramQuery, expr_id: ExprId, source_labels: &HashMap<Symbol, String>) -> ExtractionResult {
    let expr = pq.ir().exprs.get(expr_id);
    match &expr.kind {
        ExprKind::Projection { source, outputs: out_exprs, .. } => {
            let mut result = classify_expr(pq, *source, source_labels);

            if result.source_type.is_none() {
                result.source_type = pq.resolve_type_name(*source).map(|(name, _)| name);
            }

            for &out_id in out_exprs {
                let out_expr = pq.ir().exprs.get(out_id);
                if let ExprKind::RecordInstance { type_name, ctor_args, fields, .. } = &out_expr.kind {
                    let name = type_name.display(pq.interner());
                    let syms: Vec<_> = type_name.clone().into();
                    let type_fields = syms.last()
                        .map(|&s| pq.lookup_fields(s))
                        .unwrap_or_default();

                    let mut mappings = Vec::new();

                    let ctor_params = pq.resolve_ctor_params(type_name);
                    for (param_name, arg) in ctor_params.iter().zip(ctor_args.iter()) {
                        let source_expr = pq.resolve_expr_display(arg.value());
                        mappings.push(FieldMapping {
                            target: param_name.clone(),
                            source: source_expr,
                        });
                    }

                    for (sym, value_expr) in fields {
                        let target = pq.interner().resolve(*sym).to_string();
                        let source_expr = pq.resolve_expr_display(*value_expr);
                        mappings.push(FieldMapping { target, source: source_expr });
                    }

                    let rdf_type = syms.last().and_then(|&s| pq.extract_rdf_type(s));

                    result.pending.push(PipelineOutput {
                        type_name: name,
                        fields: type_fields,
                        mappings,
                        source: result.source_type.clone(),
                        destination: None,
                        rdf_type,
                    });
                }
            }

            result
        }
        ExprKind::Application { callee, args } => {
            let mut result = ExtractionResult::default();

            for arg in args {
                let sub = classify_expr(pq, arg.value(), source_labels);
                if result.source_type.is_none() {
                    result.source_type = sub.source_type;
                }
                result.outputs.extend(sub.outputs);
                result.operations.extend(sub.operations);
                result.pending.extend(sub.pending);
            }

            let callee_name = pq.resolve_callee_name(*callee);
            if let Some(ref name) = callee_name
                && (name.contains("serialize") || name.contains("write"))
            {
                let dest = args.iter().find_map(|arg| {
                    let arg_expr = pq.ir().exprs.get(arg.value());
                    if let ExprKind::Literal(fossil_lang::ir::Literal::String(s)) = &arg_expr.kind {
                        Some(pq.interner().resolve(*s).to_string())
                    } else {
                        None
                    }
                });

                for mut p in result.pending.drain(..) {
                    p.destination = dest.clone();
                    result.outputs.push(p);
                }
            }

            result
        }
        ExprKind::FieldAccess { expr: inner, .. } => classify_expr(pq, *inner, source_labels),
        ExprKind::Join { left, right, left_on, right_on, .. } => {
            let left_result = classify_expr(pq, *left, source_labels);
            let right_result = classify_expr(pq, *right, source_labels);

            let left_name = left_result.source_type.clone()
                .unwrap_or_else(|| "?".to_string());
            let right_name = right_result.source_type.clone()
                .unwrap_or_else(|| "?".to_string());

            let left_cols: Vec<String> = left_on.iter().map(|s| pq.interner().resolve(*s).to_string()).collect();
            let right_cols: Vec<String> = right_on.iter().map(|s| pq.interner().resolve(*s).to_string()).collect();

            let fields = pq.resolve_fields(expr_id);

            let mut operations = left_result.operations;
            operations.extend(right_result.operations);
            operations.push(PipelineOperation {
                kind: "join".into(),
                label: "JOIN".into(),
                fields,
                inputs: vec![
                    OperationInput { source: left_name, key_fields: left_cols },
                    OperationInput { source: right_name, key_fields: right_cols },
                ],
            });

            let mut all_outputs = left_result.outputs;
            all_outputs.extend(right_result.outputs);

            let mut all_pending = left_result.pending;
            all_pending.extend(right_result.pending);

            ExtractionResult {
                source_type: left_result.source_type,
                outputs: all_outputs,
                operations,
                pending: all_pending,
            }
        }
        ExprKind::Identifier(path) => {
            let syms: Vec<_> = path.clone().into();
            if let Some(label) = syms.first().and_then(|s| source_labels.get(s)) {
                return ExtractionResult {
                    source_type: Some(label.clone()),
                    ..Default::default()
                };
            }
            if let Some((name, _)) = pq.resolve_type_name(expr_id) {
                return ExtractionResult {
                    source_type: Some(name),
                    ..Default::default()
                };
            }
            ExtractionResult::default()
        }
        _ => ExtractionResult::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::extract_summary;
    use fossil_lang::compiler::{Compiler, CompilerInput};

    fn compile_and_extract(src: &str) -> super::super::ValidationResult {
        let result = Compiler::default()
            .compile(CompilerInput::Source {
                name: "test".into(),
                content: src.into(),
            })
            .expect("compilation failed");
        extract_summary(&result.program)
    }

    /// Verifies every condition the frontend needs to draw edges from
    /// join operation → output node: operation fields, output source,
    /// and mapping sources all align correctly.
    #[test]
    fn join_to_output_edge_conditions() {
        let result = compile_and_extract(
            "type A do X: int Y: string end\n\
             type B do X: int Z: bool end\n\
             type Out do Y: string Z: bool end\n\
             let a = A { X = 1, Y = \"hi\" }\n\
             let b = B { X = 1, Z = true }\n\
             a |> join b on X = X |> each row -> Out { Y = row.Y, Z = row.Z }",
        );

        assert!(result.valid);

        // Join operation exists with merged fields
        assert_eq!(result.pipeline.operations.len(), 1);
        let join_op = &result.pipeline.operations[0];
        assert_eq!(join_op.kind, "join");
        assert!(
            !join_op.fields.is_empty(),
            "join operation fields are empty — frontend cannot create edges"
        );
        let join_field_names: Vec<&str> = join_op.fields.iter().map(|f| f.name.as_str()).collect();

        // Output exists with source matching a join input
        assert!(!result.pipeline.outputs.is_empty(), "no outputs found");
        let out = &result.pipeline.outputs[0];
        assert_eq!(out.type_name, "Out");
        let source = out.source.as_deref().expect("output.source is None");
        let matches_join = join_op.inputs.iter().any(|inp| inp.source == source);
        assert!(matches_join, "output.source '{}' doesn't match any join input", source);

        // Each mapping.source must exist in join fields (srcFieldSet check)
        assert!(!out.mappings.is_empty(), "output should have field mappings");
        let mapping_targets: Vec<&str> = out.mappings.iter().map(|m| m.target.as_str()).collect();
        assert!(mapping_targets.contains(&"Y"));
        assert!(mapping_targets.contains(&"Z"));

        for m in &out.mappings {
            assert!(
                join_field_names.contains(&m.source.as_str()),
                "mapping.source '{}' not in join fields {:?} — edge will NOT be drawn",
                m.source, join_field_names
            );
        }

        // Each mapping.target must exist in output fields (outFieldSet check)
        let out_field_names: Vec<&str> = out.fields.iter().map(|f| f.name.as_str()).collect();
        for m in &out.mappings {
            assert!(
                out_field_names.contains(&m.target.as_str()),
                "mapping.target '{}' not in output fields {:?} — edge will NOT be drawn",
                m.target, out_field_names
            );
        }
    }

}
